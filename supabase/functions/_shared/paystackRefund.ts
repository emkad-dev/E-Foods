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
import { buildRefundReference, initiatePaystackRefund, toKoboAmount, type PaystackCallOutcome } from './paystack.ts';
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
  /** Not eligible; nothing was sent. */
  | { kind: 'refused'; reason: string }
  | { kind: 'not_found' }
  /** Lost the claim: someone else started a refund (or the order changed) first. */
  | { kind: 'changed' };

export type PaystackRefundDeps = {
  initiate: typeof initiatePaystackRefund;
};

const defaultDeps: PaystackRefundDeps = { initiate: initiatePaystackRefund };

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
  input: { orderId: string; requestedBy: RefundRequester },
  deps: PaystackRefundDeps = defaultDeps
): Promise<SendOrderRefundResult> => {
  const order = await loadOrder(input.orderId);
  if (!order) {
    return { kind: 'not_found' };
  }

  const payment = paymentOf(order);
  const eligibility = assessPaystackRefund(payment, isPaymentCaptured(payment));
  if (!eligibility.ok) {
    return { kind: 'refused', reason: eligibility.reason };
  }

  const amountKobo = toKoboAmount(eligibility.amount);
  const transactionKobo = transactionAmountKobo(payment);
  if (amountKobo <= 0 || (transactionKobo !== null && amountKobo > transactionKobo)) {
    return { kind: 'refused', reason: 'over_cap' };
  }

  const previous = readRefundExecution(payment);
  const attempt = (previous?.attempt ?? 0) + 1;
  const reference = buildRefundReference(order.id, attempt);
  const requestedAt = nowIso();
  const claimed: RefundExecution = {
    amount: eligibility.amount,
    attempt,
    failedAt: null,
    lastError: null,
    paystackRefundId: null,
    processedAt: null,
    reference,
    requestedAt,
    requestedBy: input.requestedBy,
    status: 'requested',
  };

  // THE claim. Also guarded on payment.status (the record must still exist)
  // and on updatedAt, because the whole payment object is written back.
  let claim = serviceClient
    .from('CustomerOrder')
    .update({ payment: { ...payment, refundExecution: toStoredExecution(claimed) }, updatedAt: requestedAt })
    .eq('id', order.id)
    .eq('payment->>status', 'refunded');
  claim = whereExecutionIs(claim, previous);
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
    };
    kind = 'unconfirmed';
  }

  const recorded = await recordExecutionTransition(order.id, claimed, next);
  return { execution: recorded ?? next, kind };
};

/**
 * Writes `next` over the execution this call last saw, as a compare-and-set on
 * that execution (same reference and status). A refund webhook can land
 * between Paystack's answer and this write; when it already moved the
 * execution, its state stands (it is at least as new) and only a missing
 * Paystack refund id is filled in. Runs the transition's side effects only when
 * THIS write applied, so each one happens once. Returns the stored execution.
 */
const recordExecutionTransition = async (
  orderId: string,
  current: RefundExecution,
  next: RefundExecution
): Promise<RefundExecution | null> => {
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
  const { data: written, error } = await write.select('id');
  if (error) {
    // The refund request already went out: log loudly and leave the claim
    // ('requested') standing. The webhook will move it on.
    logEdgeEvent('error', 'refund outcome write failed', { error: error.message, orderId, status: next.status });
    return stored;
  }
  if (!Array.isArray(written) || written.length === 0) {
    // Changed under us: report what is stored now.
    const fresh = await loadOrder(orderId);
    return fresh ? readRefundExecution(paymentOf(fresh)) : null;
  }

  await runTransitionSideEffects(order, next);
  return next;
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
      type: 'refund_processed',
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
    details: `The Paystack refund of ${amountLabel(execution)} for order ${orderId} failed: ${reason} No money left FEASTY for this attempt. Retry with "Refund via Paystack" on the order, or return it by hand.`,
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
    details: `The Paystack refund of ${amountLabel(execution)} for order ${orderId} needs attention. ${detail} Do not refund by hand until you have checked Paystack.`,
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

/** The order (of possibly several sharing one charge) this refund event is about. */
const findRefundOrder = async (input: RefundWebhookInput): Promise<CustomerOrderRow | null> => {
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

  if (input.refundReference) {
    // Our reference names the order and the attempt: an event for an older,
    // failed attempt does not touch a newer one.
    return withExecution.find((entry) => sameReference(entry.execution.reference, input.refundReference))?.row ?? null;
  }
  if (input.paystackRefundId) {
    const byId = withExecution.find((entry) => entry.execution.paystackRefundId === input.paystackRefundId);
    if (byId) return byId.row;
  }
  // No reference and no known id: only an unambiguous match on amount counts.
  const open = withExecution.filter(
    (entry) =>
      entry.execution.status !== 'processed' &&
      entry.execution.status !== 'failed' &&
      entry.execution.amount !== null &&
      input.amountKobo !== null &&
      toKoboAmount(entry.execution.amount) === input.amountKobo
  );
  return open.length === 1 ? open[0].row : null;
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

  let order = await findRefundOrder(input);
  if (!order) {
    return { ignored: true, reason: 'not_our_refund' };
  }

  for (let attempt = 0; attempt < MAX_WEBHOOK_WRITE_ATTEMPTS; attempt += 1) {
    const current = readRefundExecution(paymentOf(order));
    if (!current || (input.refundReference && !sameReference(current.reference, input.refundReference))) {
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
