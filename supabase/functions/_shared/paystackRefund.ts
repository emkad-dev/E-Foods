// Paystack refund execution: returns the money a paid order's REFUND RECORD
// (payment.status 'refunded' + refundAmount, written by buildRefundUpdate when
// the order closed) says is owed. Progress lives in payment.refundExecution
// (see packages/domain/src/refundExecution.ts); no new columns.
//
// Money-safety rules, each enforced here and covered by paystackRefund.test.ts:
//   * One execution per order. The claim is a compare-and-set on the stored
//     execution being absent (or the previous attempt failed, with the same
//     reference), so two admin clicks, or an automatic refund racing an admin,
//     cannot both reach Paystack: the second UPDATE matches no row.
//   * The amount is the recorded refundAmount, capped by what this order
//     captured and by the Paystack transaction amount; never more.
//   * Only a captured payment (isPaymentCaptured) whose refund is RECORDED
//     (status 'refunded') is ever refunded.
//   * Each attempt sends its own reference, so even a duplicated request is
//     refused by Paystack (409) rather than paid twice.
//   * An answer we cannot read (timeout, 5xx) is NOT a failure: the refund may
//     exist. It is marked needs_attention, never retried automatically, and a
//     human checks the Paystack dashboard. Only a definite refusal (4xx) or
//     Paystack's refund.failed (money credited back to FEASTY) is 'failed', the
//     one state from which a new attempt may start.

import {
  assessPaystackRefund,
  canMarkRefundedManually,
  mapPaystackRefundStatus,
  readRefundExecution,
  shouldApplyRefundStatus,
  type RefundExecution,
  type RefundExecutionStatus,
} from '../../../packages/domain/src/refundExecution.ts';
import { serviceClient } from './client.ts';
import { buildRefundUpdate } from './domains/orders.ts';
import { formatNairaAmount, shortOrderCode } from './email.ts';
import { isFeatureEnabled, loadFeatureFlagMap } from './featureFlags.ts';
import { MANUAL_REFUND_ALERT_TYPE } from './manualRefund.ts';
import { buildNotificationData, notifyAdmins, notifyUsers } from './notifications.ts';
import { logEdgeEvent } from './observability.ts';
import { recordOperationalAlert } from './operationalAlerts.ts';
import { CUSTOMER_ORDER_COLUMNS, insertDeliveryEvent, isPaymentCaptured, type CustomerOrderRow } from './orders.ts';
import {
  buildRefundReference,
  initiatePaystackRefund,
  listPaystackRefunds,
  toKoboAmount,
  type PaystackCallOutcome,
} from './paystack.ts';
import { broadcastOrderChanged } from './realtime.ts';
import { nowIso, sanitizeText, type JsonObject } from './rpc/coercion.ts';

export const AUTO_REFUNDS_FLAG = 'auto_refunds';
export const REFUND_FAILED_ALERT_TYPE = 'refund_failed';
export const REFUND_NEEDS_ATTENTION_ALERT_TYPE = 'refund_needs_attention';

/** 'admin:<uid>' for the admin button, 'auto' for the automatic refunds. */
export type RefundRequester = 'auto' | `admin:${string}`;

export type SendOrderRefundResult =
  /** Paystack accepted the refund (its status is on the execution). */
  | { execution: RefundExecution; kind: 'sent' }
  /** Paystack definitely refused it; nothing was created. A retry may start. */
  | { execution: RefundExecution; kind: 'failed' }
  /** No usable answer: the refund may exist. A human checks Paystack. */
  | { execution: RefundExecution; kind: 'unconfirmed' }
  /** Paystack already holds a refund on this charge that FEASTY did not send. Nothing sent. */
  | { execution: RefundExecution; kind: 'blocked' }
  /** Not eligible; nothing was sent. */
  | { kind: 'refused'; reason: string }
  | { kind: 'not_found' }
  /** Lost the claim: someone else started a refund (or the order changed) first. */
  | { kind: 'changed' };

export type PaystackRefundDeps = {
  initiate: typeof initiatePaystackRefund;
  listRefunds: typeof listPaystackRefunds;
};

const defaultDeps: PaystackRefundDeps = { initiate: initiatePaystackRefund, listRefunds: listPaystackRefunds };

// ── Refunds already at Paystack ─────────────────────────────────────────────
//
// Before sending, FEASTY looks at the refunds Paystack already holds on the
// charge: an owner who refunded from the Paystack dashboard (or before this
// feature existed) must never be refunded a second time by us.

export type ExistingRefund = { id: string | null; reference: string | null; status: string };

export type ExistingRefundLookup = { kind: 'ok'; refunds: ExistingRefund[] } | { kind: 'error'; message: string };

const REFUND_LIST_PAGE_SIZE = 100;
const MAX_REFUND_LIST_PAGES = 10;

const idText = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : sanitizeText(value) || null;

/** Paystack's numeric id for the charge, from the stored verify answer. */
const transactionIdOf = (payment: JsonObject): string | null => {
  const response = payment.paystackResponse;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  return idText((response as JsonObject).id);
};

/**
 * Every refund Paystack holds on one charge. Lists by date from the day before
 * the payment (a documented filter) and matches the charge itself, by its id
 * or reference, so it does not depend on the ambiguous `reference` filter.
 * Anything it cannot establish (no stored charge id or payment date, a failed
 * or unreadable page, more pages than the cap) is an error: the caller then
 * does not send.
 */
export const findPaystackRefundsForCharge = async (
  input: { paidAt: string | null; transactionId: string | null; transactionReference: string },
  list: typeof listPaystackRefunds = listPaystackRefunds
): Promise<ExistingRefundLookup> => {
  if (!input.transactionId) {
    return { kind: 'error', message: 'The Paystack transaction id is not stored on this payment.' };
  }
  const paidMs = input.paidAt ? Date.parse(input.paidAt) : NaN;
  if (!Number.isFinite(paidMs)) {
    return { kind: 'error', message: 'The payment date is not stored on this payment.' };
  }
  const from = new Date(paidMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const reference = input.transactionReference.toLowerCase();
  const refunds: ExistingRefund[] = [];

  for (let page = 1; page <= MAX_REFUND_LIST_PAGES; page += 1) {
    const outcome = await list({ from, page, perPage: REFUND_LIST_PAGE_SIZE });
    if (outcome.kind !== 'ok') {
      return { kind: 'error', message: outcome.message };
    }
    if (!Array.isArray(outcome.data)) {
      return { kind: 'error', message: 'Paystack returned an unreadable refund list.' };
    }
    const rows = outcome.data as unknown[];
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as JsonObject;
      const transaction = row.transaction;
      const transactionObject =
        transaction && typeof transaction === 'object' && !Array.isArray(transaction) ? (transaction as JsonObject) : null;
      const rowTransactionId = transactionObject ? idText(transactionObject.id) : idText(transaction);
      const rowTransactionReference = (
        sanitizeText(transactionObject?.reference) || sanitizeText(row.transaction_reference)
      ).toLowerCase();
      if (rowTransactionId !== input.transactionId && rowTransactionReference !== reference) continue;
      refunds.push({
        id: idText(row.id),
        reference: sanitizeText(row.reference) || sanitizeText(row.refund_reference) || null,
        status: sanitizeText(row.status).toLowerCase(),
      });
    }
    const pageCount = Number((outcome.meta ?? {}).pageCount);
    const lastPage = Number.isFinite(pageCount) ? page >= pageCount : rows.length < REFUND_LIST_PAGE_SIZE;
    if (lastPage) {
      return { kind: 'ok', refunds };
    }
  }
  return { kind: 'error', message: 'Too many Paystack refunds to check since this payment.' };
};

export type ExistingRefundVerdict =
  | { kind: 'clear' }
  /** This exact attempt already exists at Paystack (a resend): adopt it. */
  | { kind: 'ours'; refund: ExistingRefund }
  /** A live refund FEASTY did not send for this attempt: never send another. */
  | { kind: 'foreign'; refund: ExistingRefund };

/**
 * Failed refunds credit the money back and are ignored. A live refund carrying
 * this attempt's reference is ours. Another order's FEASTY refund on the same
 * (multi-restaurant) charge is fine. Anything else - no reference, a reference
 * FEASTY did not make, or an earlier attempt of THIS order still alive - is
 * foreign.
 */
export const judgeExistingRefunds = (
  refunds: ExistingRefund[],
  input: { orderId: string; reference: string }
): ExistingRefundVerdict => {
  const ours = input.reference.toLowerCase();
  const thisOrderPrefix = ours.replace(/_\d+$/, '_');
  for (const refund of refunds) {
    if (refund.status === 'failed') continue;
    const reference = refund.reference?.toLowerCase() ?? '';
    if (reference === ours) return { kind: 'ours', refund };
    if (reference.startsWith('feasty_rf_') && !reference.startsWith(thisOrderPrefix)) continue;
    return { kind: 'foreign', refund };
  }
  return { kind: 'clear' };
};

const loadOrder = async (orderId: string): Promise<CustomerOrderRow | null> => {
  const { data, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq('id', orderId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as CustomerOrderRow | null) ?? null;
};

const paymentOf = (order: CustomerOrderRow) => (order.payment ?? {}) as JsonObject;

/** The Paystack transaction amount in kobo, when the verification stored it. */
const transactionAmountKobo = (payment: JsonObject): number | null => {
  const response = payment.paystackResponse;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const amount = (response as JsonObject).amount;
  const parsed = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Filters an UPDATE to the exact execution state this call read: no execution
// at all, or this precise attempt (status + reference). Under the row lock
// Postgres re-evaluates these, so only one of two racing writers matches.
// deno-lint-ignore no-explicit-any
const whereExecutionIs = (query: any, execution: RefundExecution | null) => {
  if (!execution) {
    return query.is('payment->refundExecution', null);
  }
  query = query.eq('payment->refundExecution->>status', execution.status);
  return execution.reference
    ? query.eq('payment->refundExecution->>reference', execution.reference)
    : query.is('payment->refundExecution->>reference', null);
};

const toStoredExecution = (execution: RefundExecution): JsonObject => ({ ...execution });

/**
 * Starts the Paystack refund of an order's recorded refund. Never sends two:
 * see the module header. Throws only on a database error before the claim; once
 * the claim is written every outcome is recorded on the order and returned.
 */
export const sendOrderRefund = async (
  input: {
    /** An admin may resend an unconfirmed attempt (same reference); the automatic path may not. */
    allowUnconfirmed?: boolean;
    orderId: string;
    requestedBy: RefundRequester;
  },
  deps: PaystackRefundDeps = defaultDeps
): Promise<SendOrderRefundResult> => {
  const order = await loadOrder(input.orderId);
  if (!order) {
    return { kind: 'not_found' };
  }

  const payment = paymentOf(order);
  const eligibility = assessPaystackRefund(payment, isPaymentCaptured(payment), {
    allowUnconfirmed: input.allowUnconfirmed === true,
    nowMs: Date.now(),
  });
  if (!eligibility.ok) {
    return { kind: 'refused', reason: eligibility.reason };
  }

  const amountKobo = toKoboAmount(eligibility.amount);
  const transactionKobo = transactionAmountKobo(payment);
  if (amountKobo <= 0 || (transactionKobo !== null && amountKobo > transactionKobo)) {
    return { kind: 'refused', reason: 'over_cap' };
  }

  const previous = readRefundExecution(payment);
  // RESUME: a claim stuck in 'requested' past STALE_REQUESTED_MS, or (admin) an
  // unconfirmed attempt. Same attempt, SAME reference: if the first request did
  // reach Paystack, the lookup below adopts it, and a resend is refused 409.
  const resume = eligibility.resume && previous !== null && previous.reference !== null;
  const attempt = resume ? previous.attempt : (previous?.attempt ?? 0) + 1;
  const reference = resume ? (previous.reference as string) : buildRefundReference(order.id, attempt);
  const requestedAt = nowIso();
  const claimed: RefundExecution = {
    amount: eligibility.amount,
    attempt,
    failedAt: null,
    lastError: null,
    manual: false,
    paystackRefundId: null,
    processedAt: null,
    reference,
    requestedAt,
    requestedBy: input.requestedBy,
    status: 'requested',
    unconfirmed: false,
  };

  // THE claim. Also guarded on payment.status (the record must still exist)
  // and on updatedAt, because the whole payment object is written back.
  let claim = serviceClient
    .from('CustomerOrder')
    .update({ payment: { ...payment, refundExecution: toStoredExecution(claimed) }, updatedAt: requestedAt })
    .eq('id', order.id)
    .eq('payment->>status', 'refunded');
  claim = whereExecutionIs(claim, previous);
  if (resume) {
    // Two concurrent resumes see the same stale claim: only the one that
    // replaces this exact requestedAt goes on.
    claim = previous.requestedAt
      ? claim.eq('payment->refundExecution->>requestedAt', previous.requestedAt)
      : claim.is('payment->refundExecution->>requestedAt', null);
  }
  if (typeof order.updatedAt === 'string') {
    claim = claim.eq('updatedAt', order.updatedAt);
  }
  const { data: claimedRows, error: claimError } = await claim.select('id');
  if (claimError) {
    throw new Error(claimError.message);
  }
  if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
    return { kind: 'changed' };
  }

  // Never refund a charge Paystack already refunded some other way.
  let lookup: ExistingRefundLookup;
  try {
    lookup = await findPaystackRefundsForCharge(
      {
        paidAt: sanitizeText(payment.paidAt) || null,
        transactionId: transactionIdOf(payment),
        transactionReference: eligibility.transactionReference,
      },
      deps.listRefunds
    );
  } catch (error) {
    lookup = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (lookup.kind === 'error') {
    // Nothing was sent, so resending this same reference later is safe.
    const next: RefundExecution = {
      ...claimed,
      lastError: `Could not check Paystack for an existing refund on this payment (${lookup.message}). Nothing was sent.`,
      status: 'needs_attention',
      unconfirmed: true,
    };
    const recorded = await recordExecutionTransition(order.id, claimed, next);
    return { execution: recorded ?? next, kind: 'unconfirmed' };
  }
  const verdict = judgeExistingRefunds(lookup.refunds, { orderId: order.id, reference });
  if (verdict.kind === 'foreign') {
    const next: RefundExecution = {
      ...claimed,
      lastError: `A refund already exists on this payment in Paystack${
        verdict.refund.reference ? ` (reference ${verdict.refund.reference}, ${verdict.refund.status})` : ` (${verdict.refund.status})`
      }. Nothing was sent.`,
      status: 'needs_attention',
    };
    const recorded = await recordExecutionTransition(order.id, claimed, next);
    return { execution: recorded ?? next, kind: 'blocked' };
  }
  if (verdict.kind === 'ours') {
    // This very attempt already reached Paystack: adopt it instead of resending.
    const status = mapPaystackRefundStatus(verdict.refund.status) ?? 'pending';
    const next: RefundExecution = {
      ...claimed,
      paystackRefundId: verdict.refund.id,
      status,
      ...(status === 'processed' ? { processedAt: nowIso() } : {}),
    };
    const recorded = await recordExecutionTransition(order.id, claimed, next);
    return { execution: recorded ?? next, kind: 'sent' };
  }

  let outcome: PaystackCallOutcome;
  try {
    outcome = await deps.initiate({
      amountKobo,
      customerNote: `Refund for FEASTY order ${shortOrderCode(order.id)}`,
      merchantNote: `Order ${order.id} refund (${input.requestedBy}, attempt ${attempt})`,
      reference,
      transactionReference: eligibility.transactionReference,
    });
  } catch (error) {
    // initiatePaystackRefund validates before any network call, and callPaystack
    // turns network failures into 'unknown'. A throw here is either a
    // validation refusal (nothing sent) or something unexpected - and an
    // unexpected throw might come after the request left, so it is unconfirmed.
    const message = error instanceof Error ? error.message : String(error);
    outcome = /must be a positive|not a valid Paystack|reference is required/.test(message)
      ? { httpStatus: 400, kind: 'rejected', message }
      : { kind: 'unknown', message };
  }

  let next: RefundExecution;
  let kind: 'sent' | 'failed' | 'unconfirmed';
  if (outcome.kind === 'ok') {
    const data = (outcome.data ?? {}) as JsonObject;
    const status = mapPaystackRefundStatus(data.status) ?? 'pending';
    const paystackRefundId =
      typeof data.id === 'number' ? String(data.id) : sanitizeText(data.id) || null;
    next = {
      ...claimed,
      paystackRefundId,
      status,
      ...(status === 'processed' ? { processedAt: nowIso() } : {}),
      ...(status === 'failed' ? { failedAt: nowIso(), lastError: 'Paystack reported the refund as failed.' } : {}),
    };
    kind = status === 'failed' ? 'failed' : 'sent';
  } else if (outcome.kind === 'rejected' && outcome.httpStatus !== 409) {
    next = { ...claimed, failedAt: nowIso(), lastError: outcome.message, status: 'failed' };
    kind = 'failed';
  } else {
    // A 409 means a refund with this reference already exists; anything else
    // here had no readable answer. Either way the money may be moving.
    next = {
      ...claimed,
      lastError: `${outcome.message} Paystack did not confirm this refund: check the Paystack dashboard before refunding again.`,
      status: 'needs_attention',
      unconfirmed: true,
    };
    kind = 'unconfirmed';
  }

  const recorded = await recordExecutionTransition(order.id, claimed, next);
  return { execution: recorded ?? next, kind };
};

/**
 * Writes `next` over the execution this call last saw, as a compare-and-set on
 * that execution (same reference and status) AND on the order's updatedAt, so
 * a concurrent change to another payment field is never overwritten by the
 * payment object this call read. On a lost guard it re-reads once and
 * re-applies. A refund webhook can land between Paystack's answer and this
 * write; when it already moved the execution, its state stands (it is at least
 * as new) and only a missing Paystack refund id is filled in. Runs the
 * transition's side effects only when THIS write applied, so each one happens
 * once. Returns the stored execution.
 */
const recordExecutionTransition = async (
  orderId: string,
  current: RefundExecution,
  next: RefundExecution
): Promise<RefundExecution | null> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const order = await loadOrder(orderId);
    if (!order) return null;
    const payment = paymentOf(order);
    const stored = readRefundExecution(payment);
    if (!stored || stored.reference !== current.reference) {
      return stored;
    }

    if (stored.status !== current.status) {
      if (!stored.paystackRefundId && next.paystackRefundId) {
        const filled = { ...stored, paystackRefundId: next.paystackRefundId };
        let fill = serviceClient
          .from('CustomerOrder')
          .update({ payment: { ...payment, refundExecution: toStoredExecution(filled) } })
          .eq('id', orderId);
        fill = whereExecutionIs(fill, stored);
        if (typeof order.updatedAt === 'string') {
          fill = fill.eq('updatedAt', order.updatedAt);
        }
        const { error } = await fill.select('id');
        if (error) {
          logEdgeEvent('error', 'refund id fill failed', { error: error.message, orderId });
        }
        return filled;
      }
      return stored;
    }

    const raisesAttention = next.status === 'failed' || next.status === 'needs_attention';
    let write = serviceClient
      .from('CustomerOrder')
      .update({
        payment: { ...payment, refundExecution: toStoredExecution(next) },
        ...(raisesAttention ? { needsAttention: true } : {}),
        updatedAt: nowIso(),
      })
      .eq('id', orderId);
    write = whereExecutionIs(write, stored);
    if (typeof order.updatedAt === 'string') {
      write = write.eq('updatedAt', order.updatedAt);
    }
    const { data: written, error } = await write.select('id');
    if (error) {
      // The refund request already went out: log loudly and leave the claim
      // ('requested') standing. The webhook, or a resume, moves it on.
      logEdgeEvent('error', 'refund outcome write failed', { error: error.message, orderId, status: next.status });
      return stored;
    }
    if (Array.isArray(written) && written.length > 0) {
      await runTransitionSideEffects(order, next);
      return next;
    }
    // Lost the guard: read again and re-apply once.
  }
  const fresh = await loadOrder(orderId);
  return fresh ? readRefundExecution(paymentOf(fresh)) : null;
};

/**
 * What a status change means outside the order row. Best-effort: never throws
 * (the state is already committed, and a webhook answered 500 over a failed
 * email would be redelivered against a state that no longer changes).
 */
const runTransitionSideEffects = async (order: CustomerOrderRow, execution: RefundExecution) => {
  try {
    if (execution.status === 'processed') {
      await onRefundProcessed(order, execution);
    } else if (execution.status === 'failed') {
      await onRefundFailed(order, execution);
    } else if (execution.status === 'needs_attention') {
      await onRefundNeedsAttention(order, execution);
    }
    await broadcastOrderChanged(order.id, { restaurantId: order.restaurantId });
  } catch (error) {
    logEdgeEvent('error', 'refund side effects failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId: order.id,
      status: execution.status,
    });
  }
};

const safely = async (label: string, orderId: string, run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    logEdgeEvent('error', label, { error: error instanceof Error ? error.message : String(error), orderId });
  }
};

const amountLabel = (execution: RefundExecution) =>
  execution.amount !== null ? formatNairaAmount(execution.amount) : 'the refund';

const onRefundProcessed = async (order: CustomerOrderRow, execution: RefundExecution) => {
  const orderId = order.id;
  // Marked refunded by hand: no Paystack refund, so no "on its way" push.
  const manual = execution.manual;
  // The same rules as the status-write clear (orders.ts): a customer problem
  // report or a payment Paystack reversed still needs a human, so the flag
  // stays. Guarded on the execution still being processed.
  await safely('refund attention clear failed', orderId, async () => {
    const { error } = await serviceClient
      .from('CustomerOrder')
      .update({ needsAttention: false })
      .eq('id', orderId)
      .eq('needsAttention', true)
      .eq('payment->refundExecution->>status', 'processed')
      .is('customerIssueReportedAt', null)
      .is('timeline->>paymentReversedAt', null);
    if (error) throw new Error(error.message);
  });

  // The alerts that asked a human to return this money are answered.
  await safely('refund alert resolve failed', orderId, async () => {
    const { error } = await serviceClient
      .from('OperationalAlert')
      .update({ resolvedAt: nowIso(), resolvedBy: 'paystack_refund' })
      .in('dedupeKey', [
        `ops:${MANUAL_REFUND_ALERT_TYPE}:${orderId}`,
        `ops:payment_on_closed_order:${orderId}`,
        `ops:${REFUND_FAILED_ALERT_TYPE}:${orderId}`,
        `ops:${REFUND_NEEDS_ATTENTION_ALERT_TYPE}:${orderId}`,
      ])
      .is('resolvedAt', null);
    if (error) throw new Error(error.message);
  });

  if (manual) {
    return;
  }

  await safely('refund event insert failed', orderId, () =>
    insertDeliveryEvent({
      actorUid: null,
      details: { amount: execution.amount, paystackRefundId: execution.paystackRefundId, reference: execution.reference },
      eventType: 'refund_processed',
      orderId,
    })
  );

  await notifyUsers([order.customerId], {
    title: 'Refund on its way',
    body: `Your refund of ${amountLabel(execution)} is on its way. Banks can take a few working days.`,
    data: buildNotificationData({
      app: 'customer',
      orderId,
      routeKey: 'customer_order_detail',
      // The existing customer push type (its channel and sound are mapped).
      type: 'order_update',
    }),
  });
};

const onRefundFailed = async (order: CustomerOrderRow, execution: RefundExecution) => {
  const orderId = order.id;
  const reason = execution.lastError ?? 'Paystack did not give a reason.';
  await safely('refund event insert failed', orderId, () =>
    insertDeliveryEvent({
      actorUid: null,
      details: { amount: execution.amount, reason, reference: execution.reference },
      eventType: 'refund_failed',
      orderId,
    })
  );
  await recordOperationalAlert({
    alertType: REFUND_FAILED_ALERT_TYPE,
    dedupeKey: `ops:${REFUND_FAILED_ALERT_TYPE}:${orderId}`,
    details: `The Paystack refund of ${amountLabel(execution)} for order ${orderId} failed: ${reason} No money left FEASTY for this attempt. Use "Refund via Paystack" on the order page to retry, or mark it refunded by hand there.`,
    metadata: {
      amount: execution.amount,
      attempt: execution.attempt,
      paystackRefundId: execution.paystackRefundId,
      reason,
      reference: execution.reference,
      restaurantId: order.restaurantId,
    },
    severity: 'high',
    subjectId: orderId,
    subjectType: 'order',
    title: 'Refund failed',
  });
  await notifyAdmins({
    title: 'Refund failed',
    body: `The Paystack refund of ${amountLabel(execution)} for order ${shortOrderCode(orderId)} failed: ${reason}`,
    data: buildNotificationData({
      app: 'admin',
      orderId,
      restaurantId: order.restaurantId,
      routeKey: 'admin_access',
      type: REFUND_FAILED_ALERT_TYPE,
    }),
  });
};

const onRefundNeedsAttention = async (order: CustomerOrderRow, execution: RefundExecution) => {
  const orderId = order.id;
  // Ours (no readable answer) or Paystack's (it needs the customer's bank details).
  const detail =
    execution.lastError ??
    "Paystack needs the customer's bank account details to finish this refund: complete it from the Refunds page of the Paystack dashboard.";
  await recordOperationalAlert({
    alertType: REFUND_NEEDS_ATTENTION_ALERT_TYPE,
    dedupeKey: `ops:${REFUND_NEEDS_ATTENTION_ALERT_TYPE}:${orderId}`,
    details: `The Paystack refund of ${amountLabel(execution)} for order ${orderId} needs attention. ${detail} Check Paystack first; if the customer was refunded there, mark it refunded by hand on the order page.`,
    metadata: {
      amount: execution.amount,
      attempt: execution.attempt,
      paystackRefundId: execution.paystackRefundId,
      reference: execution.reference,
      restaurantId: order.restaurantId,
    },
    severity: 'high',
    subjectId: orderId,
    subjectType: 'order',
    title: 'Refund needs attention',
  });
  await notifyAdmins({
    title: 'Refund needs attention',
    body: `The Paystack refund of ${amountLabel(execution)} for order ${shortOrderCode(orderId)} needs attention. ${detail}`,
    data: buildNotificationData({
      app: 'admin',
      orderId,
      restaurantId: order.restaurantId,
      routeKey: 'admin_access',
      type: REFUND_NEEDS_ATTENTION_ALERT_TYPE,
    }),
  });
};

// ── Refunded by hand ───────────────────────────────────────────────────────

export type MarkRefundedManuallyResult =
  | { execution: RefundExecution; kind: 'marked' }
  | { kind: 'refused'; reason: 'already_started' | 'not_captured' | 'not_recorded' }
  | { kind: 'not_found' }
  | { kind: 'changed' };

/**
 * An admin returned the recorded refund outside FEASTY (Paystack dashboard,
 * bank transfer): the execution becomes processed + manual, which closes the
 * door to any Paystack refund of this order. Allowed only when nothing is in
 * flight at Paystack. Clears the manual-refund flag with the same rules as a
 * processed refund and resolves its alerts; the customer gets no push.
 */
export const markOrderRefundedManually = async (input: {
  adminUid: string;
  orderId: string;
}): Promise<MarkRefundedManuallyResult> => {
  const order = await loadOrder(input.orderId);
  if (!order) return { kind: 'not_found' };
  const payment = paymentOf(order);
  if (payment.status !== 'refunded') return { kind: 'refused', reason: 'not_recorded' };
  if (!isPaymentCaptured(payment)) return { kind: 'refused', reason: 'not_captured' };
  const previous = readRefundExecution(payment);
  if (!canMarkRefundedManually(previous)) return { kind: 'refused', reason: 'already_started' };

  const at = nowIso();
  const refundAmount = typeof payment.refundAmount === 'number' ? payment.refundAmount : null;
  const next: RefundExecution = {
    amount: previous?.amount ?? refundAmount,
    attempt: previous?.attempt ?? 1,
    failedAt: previous?.failedAt ?? null,
    lastError: null,
    manual: true,
    paystackRefundId: previous?.paystackRefundId ?? null,
    processedAt: at,
    reference: previous?.reference ?? null,
    requestedAt: at,
    requestedBy: `admin:${input.adminUid}`,
    status: 'processed',
    unconfirmed: false,
  };
  let write = serviceClient
    .from('CustomerOrder')
    .update({ payment: { ...payment, refundExecution: toStoredExecution(next) }, updatedAt: at })
    .eq('id', order.id)
    .eq('payment->>status', 'refunded');
  write = whereExecutionIs(write, previous);
  if (typeof order.updatedAt === 'string') {
    write = write.eq('updatedAt', order.updatedAt);
  }
  const { data: written, error } = await write.select('id');
  if (error) throw new Error(error.message);
  if (!Array.isArray(written) || written.length === 0) return { kind: 'changed' };

  await runTransitionSideEffects(order, next);
  return { execution: next, kind: 'marked' };
};

// ── Refund webhooks ────────────────────────────────────────────────────────

export type RefundWebhookInput = {
  /** Paystack's amount in kobo (sent as a string in refund events). */
  amountKobo: number | null;
  paystackRefundId: string | null;
  reason: string | null;
  refundReference: string | null;
  status: string;
  transactionReference: string;
};

export type RefundWebhookResult =
  | { ignored: true; reason: 'not_our_refund' | 'unknown_status' | 'missing_reference' }
  | { changed: boolean; ignored: false; orderId: string; status: RefundExecutionStatus };

const MAX_WEBHOOK_WRITE_ATTEMPTS = 3;

const sameReference = (a: string | null, b: string | null) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export const REFUND_WEBHOOK_UNMATCHED_ALERT_TYPE = 'refund_webhook_unmatched';

type RefundMatch = {
  /** The orders of this charge that have a refund in flight (not processed or failed). */
  openOnCharge: CustomerOrderRow[];
  /** The matched order and the reference of the attempt it was matched to. */
  match: { matchedReference: string | null; row: CustomerOrderRow } | null;
};

const isOpenExecution = (execution: RefundExecution) => execution.status !== 'processed' && execution.status !== 'failed';

/**
 * The order (of possibly several sharing one charge) this refund event is
 * about, tried in order: our refund reference, then Paystack's refund id, then
 * - only for an event with no reference at all, and only against an attempt
 * that has no Paystack id yet - an unambiguous amount.
 */
const findRefundOrder = async (input: RefundWebhookInput): Promise<RefundMatch> => {
  const { data, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq('payment->>reference', input.transactionReference);
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as CustomerOrderRow[];
  const withExecution = rows
    .map((row) => ({ execution: readRefundExecution(paymentOf(row)), row }))
    .filter((entry): entry is { execution: RefundExecution; row: CustomerOrderRow } => entry.execution !== null);
  const openOnCharge = withExecution.filter((entry) => isOpenExecution(entry.execution)).map((entry) => entry.row);
  const found = (entry: { execution: RefundExecution; row: CustomerOrderRow } | undefined): RefundMatch => ({
    match: entry ? { matchedReference: entry.execution.reference, row: entry.row } : null,
    openOnCharge,
  });

  if (input.refundReference) {
    const byReference = withExecution.find((entry) => sameReference(entry.execution.reference, input.refundReference));
    if (byReference) return found(byReference);
  }
  if (input.paystackRefundId) {
    const byId = withExecution.find((entry) => entry.execution.paystackRefundId === input.paystackRefundId);
    if (byId) return found(byId);
  }
  if (!input.refundReference && input.amountKobo !== null) {
    const byAmount = withExecution.filter(
      (entry) =>
        isOpenExecution(entry.execution) &&
        !entry.execution.paystackRefundId &&
        entry.execution.amount !== null &&
        toKoboAmount(entry.execution.amount) === input.amountKobo
    );
    if (byAmount.length === 1) return found(byAmount[0]);
  }
  return found(undefined);
};

/**
 * Applies one Paystack refund event (refund.pending / processing /
 * needs-attention / processed / failed). Idempotent and redelivery-safe: an
 * event that does not move the execution forward changes nothing, and the
 * write is a compare-and-set, so two deliveries of the same event apply once
 * and notify once. Refunds FEASTY did not start (made by hand in the Paystack
 * dashboard) are ignored. Throws on a database error so the webhook answers
 * 500 and Paystack redelivers.
 */
export const applyRefundWebhook = async (input: RefundWebhookInput): Promise<RefundWebhookResult> => {
  const nextStatus = mapPaystackRefundStatus(input.status);
  if (!nextStatus) {
    return { ignored: true, reason: 'unknown_status' };
  }
  if (!sanitizeText(input.transactionReference)) {
    return { ignored: true, reason: 'missing_reference' };
  }

  const { match, openOnCharge } = await findRefundOrder(input);
  if (!match) {
    // A refund on a charge where FEASTY has one in flight, that matches none
    // of ours (a dashboard refund, an older attempt): a human must look.
    if (openOnCharge.length > 0) {
      await recordOperationalAlert({
        alertType: REFUND_WEBHOOK_UNMATCHED_ALERT_TYPE,
        dedupeKey: `ops:${REFUND_WEBHOOK_UNMATCHED_ALERT_TYPE}:${input.transactionReference}:${
          input.refundReference ?? input.paystackRefundId ?? 'unknown'
        }`,
        details: `Paystack sent ${input.status} for a refund on charge ${input.transactionReference} (refund reference ${
          input.refundReference ?? 'none'
        }, Paystack id ${input.paystackRefundId ?? 'none'}) that matches no FEASTY refund, while order(s) ${openOnCharge
          .map((row) => row.id)
          .join(', ')} have one in flight. The customer may be refunded twice: check Paystack.`,
        metadata: {
          amountKobo: input.amountKobo,
          orderIds: openOnCharge.map((row) => row.id),
          paystackRefundId: input.paystackRefundId,
          refundReference: input.refundReference,
          status: input.status,
          transactionReference: input.transactionReference,
        },
        severity: 'high',
        subjectId: openOnCharge[0].id,
        subjectType: 'order',
        title: 'Unmatched Paystack refund',
      });
    }
    return { ignored: true, reason: 'not_our_refund' };
  }
  let order = match.row;

  for (let attempt = 0; attempt < MAX_WEBHOOK_WRITE_ATTEMPTS; attempt += 1) {
    const current = readRefundExecution(paymentOf(order));
    // Still the attempt the event was matched to (a retry may have replaced it).
    if (!current || current.reference !== match.matchedReference) {
      return { ignored: true, reason: 'not_our_refund' };
    }
    if (
      input.amountKobo !== null &&
      current.amount !== null &&
      toKoboAmount(current.amount) !== input.amountKobo
    ) {
      logEdgeEvent('warn', 'refund webhook amount differs from the amount sent', {
        orderId: order.id,
        paystackAmountKobo: input.amountKobo,
        sentAmountKobo: toKoboAmount(current.amount),
      });
    }
    if (current.manual && nextStatus !== 'failed') {
      // Marked refunded by hand, yet Paystack is moving a refund for it too.
      await recordOperationalAlert({
        alertType: REFUND_NEEDS_ATTENTION_ALERT_TYPE,
        dedupeKey: `ops:refund_paid_twice:${order.id}`,
        details: `Order ${order.id} was marked refunded by hand, but Paystack reports a refund on it as ${nextStatus}${
          input.refundReference ? ` (reference ${input.refundReference})` : ''
        }. The customer may be refunded twice: check Paystack now.`,
        metadata: { paystackRefundId: input.paystackRefundId, refundReference: input.refundReference, status: nextStatus },
        severity: 'high',
        subjectId: order.id,
        subjectType: 'order',
        title: 'Refund may be paid twice',
      });
      return { changed: false, ignored: false, orderId: order.id, status: current.status };
    }
    if (!shouldApplyRefundStatus(current.status, nextStatus)) {
      return { changed: false, ignored: false, orderId: order.id, status: current.status };
    }

    const at = nowIso();
    const next: RefundExecution = {
      ...current,
      paystackRefundId: current.paystackRefundId ?? input.paystackRefundId,
      status: nextStatus,
      ...(nextStatus === 'processed' ? { lastError: null, processedAt: at } : {}),
      ...(nextStatus === 'failed'
        ? { failedAt: at, lastError: input.reason ?? 'Paystack could not process the refund.' }
        : {}),
      ...(nextStatus === 'needs_attention' ? { lastError: null } : {}),
    };
    const raisesAttention = nextStatus === 'failed' || nextStatus === 'needs_attention';

    let write = serviceClient
      .from('CustomerOrder')
      .update({
        payment: { ...paymentOf(order), refundExecution: toStoredExecution(next) },
        ...(raisesAttention ? { needsAttention: true } : {}),
        updatedAt: at,
      })
      .eq('id', order.id);
    write = whereExecutionIs(write, current);
    // And on updatedAt: the payment object written back is the one read here,
    // so any other payment change since must win (re-read below, re-applied).
    if (typeof order.updatedAt === 'string') {
      write = write.eq('updatedAt', order.updatedAt);
    }
    const { data: written, error } = await write.select('id');
    if (error) {
      throw new Error(error.message);
    }
    if (Array.isArray(written) && written.length > 0) {
      await runTransitionSideEffects(order, next);
      return { changed: true, ignored: false, orderId: order.id, status: nextStatus };
    }

    const fresh = await loadOrder(order.id);
    if (!fresh) {
      return { ignored: true, reason: 'not_our_refund' };
    }
    order = fresh;
  }

  throw new Error(`Order ${order.id} kept changing while its refund event was being recorded`);
};

// ── Automatic refunds ──────────────────────────────────────────────────────

const CLOSED_UNSERVED_STATUSES = new Set(['cancelled', 'rejected', 'failed_delivery']);

/** The auto_refunds flag. Fails safe: an unreadable FeatureFlag table means off. */
export const isAutoRefundEnabled = async (
  loadFlags: typeof loadFeatureFlagMap = loadFeatureFlagMap
): Promise<boolean> => {
  try {
    return isFeatureEnabled(await loadFlags(), AUTO_REFUNDS_FLAG);
  } catch (error) {
    logEdgeEvent('warn', 'Feature flags unreadable; treating auto refunds as off', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

/**
 * The automatic refund for a clear-cut case (a paid order the restaurant
 * rejected, an acceptance auto-cancel, money that landed on a closed order),
 * called AFTER the refund record is committed and only when the caller read
 * the flag as on. Best-effort: never throws, so the reject or cancel that
 * called it is never turned into an error. When it does not send, the manual
 * refund alert already raised by the caller remains the fallback.
 */
export const startAutomaticRefund = async (
  orderId: string,
  deps: PaystackRefundDeps = defaultDeps
): Promise<SendOrderRefundResult | null> => {
  try {
    const result = await sendOrderRefund({ orderId, requestedBy: 'auto' }, deps);
    if (result.kind === 'refused' || result.kind === 'changed' || result.kind === 'not_found') {
      logEdgeEvent('warn', 'automatic refund not sent', {
        orderId,
        outcome: result.kind,
        reason: result.kind === 'refused' ? result.reason : null,
      });
    }
    return result;
  } catch (error) {
    logEdgeEvent('error', 'automatic refund failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
    return null;
  }
};

/**
 * Money that landed on an order that was already closed (the payment
 * verification's closed-order path, which records it 'paid' and flags it).
 * With auto_refunds on, the caller calls this: it first writes the refund
 * RECORD exactly as a cancellation does (buildRefundUpdate, full rate), as a
 * compare-and-set on the payment still being 'paid' on that closed order, and
 * only then sends it. Best-effort: never throws; null when nothing was sent.
 */
export const refundPaymentOnClosedOrder = async (
  orderId: string,
  deps: PaystackRefundDeps = defaultDeps
): Promise<SendOrderRefundResult | null> => {
  try {
    const order = await loadOrder(orderId);
    if (!order) return null;
    const observedStatus = sanitizeText(order.status);
    const payment = paymentOf(order);
    if (!CLOSED_UNSERVED_STATUSES.has(observedStatus) || payment.status !== 'paid' || !isPaymentCaptured(payment)) {
      return null;
    }
    const recorded = buildRefundUpdate({
      order,
      refundRate: 1,
      reason: 'payment_on_closed_order_full_refund',
    }) as JsonObject;
    if (recorded.status !== 'refunded') {
      return null;
    }

    let write = serviceClient
      .from('CustomerOrder')
      .update({ payment: recorded, updatedAt: nowIso() })
      .eq('id', orderId)
      .eq('status', observedStatus)
      .eq('payment->>status', 'paid');
    if (typeof order.updatedAt === 'string') {
      write = write.eq('updatedAt', order.updatedAt);
    }
    const { data: written, error } = await write.select('id');
    if (error) {
      throw new Error(error.message);
    }
    if (!Array.isArray(written) || written.length === 0) {
      logEdgeEvent('warn', 'closed-order refund record lost a race; not sending', { orderId });
      return null;
    }
    return await startAutomaticRefund(orderId, deps);
  } catch (error) {
    logEdgeEvent('error', 'closed-order automatic refund failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
    return null;
  }
};
