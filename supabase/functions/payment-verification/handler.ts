/// <reference path="../_shared/edge-runtime.d.ts" />

import { serviceClient } from '../_shared/client.ts';
import { enqueueNotification } from '../_shared/queue.ts';
import type { PaymentVerificationJob } from '../_shared/queue.ts';
import { getIdempotencyRecord, storeIdempotencyRecord } from '../_shared/idempotency.ts';
import {
  buildNotificationData,
  loadRestaurantRecipientUserIds,
  notifyAdmins,
} from '../_shared/notifications.ts';
import { broadcastOrderChanged } from '../_shared/realtime.ts';
import { logEdgeEvent } from '../_shared/observability.ts';
import { capturePaymentOnClosedOrderAlert, recordOperationalAlert } from '../_shared/operationalAlerts.ts';
import { storedPaymentStatus, TERMINAL_ORDER_STATUSES } from '../_shared/orders.ts';
import {
  buildTransactionalEmailHtml,
  formatNairaAmount,
  loadUserEmailRecipient,
  sendTransactionalEmail,
  shortOrderCode,
} from '../_shared/email.ts';
import {
  resolveGroupExpectedTotal,
  toKoboAmount,
  toNumber,
  validatePaystackVerificationForOrder,
} from './invariants.ts';
import {
  capturePaymentVerificationFailureSignal,
  capturePaymentVerificationReplaySignal,
  capturePaymentVerificationRiskSignals,
} from '../_shared/riskSignals.ts';

type JsonObject = Record<string, unknown>;

type CustomerOrderRow = {
  id: string;
  customerId: string;
  orderGroupId?: string | null;
  restaurantId: string;
  status: string | null;
  payment: JsonObject | null;
  pricing: JsonObject | null;
  timeline: JsonObject | null;
  updatedAt?: string | null;
};

type OrderGroupRow = {
  id: string;
  orderIds?: JsonObject | null;
  pricing?: JsonObject | null;
};

export type PaymentVerificationRequest = PaymentVerificationJob & {
  webhookEvent?: JsonObject | null;
  /** Paystack's verify answer when the caller already asked for it (the
   * customer refresh), so one refresh does not verify the charge twice. It is
   * validated exactly like a fresh answer. */
  verifiedTransaction?: JsonObject | null;
};

const PAYSTACK_VERIFY_TIMEOUT_MS = 10_000;

const verifyPaystackTransaction = async (reference: string) => {
  const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!paystackSecretKey) throw new Error('PAYSTACK_SECRET_KEY not configured');

  let response: Response;
  try {
    response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
      },
      signal: AbortSignal.timeout(PAYSTACK_VERIFY_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`Paystack verification timed out after ${PAYSTACK_VERIFY_TIMEOUT_MS}ms`);
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Paystack verification failed: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.status !== true) {
    throw new Error(`Payment verification failed: ${data.message}`);
  }

  return data.data as JsonObject;
};

const normalizeStatus = (value: unknown, fallback: string) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
};

const upsertPaymentTransaction = async (
  order: CustomerOrderRow,
  transactionData: JsonObject,
  paymentStatus: string,
  webhookEvent: JsonObject | null,
  // A multi-store group is one Paystack charge: record the group total, not the
  // primary order's own share. Omitted (single order) => the order's total.
  amountOverride?: number,
  // When the charge was paid earlier (a ledger repaired on a retry), not now.
  paidAtOverride?: string
) => {
  const payment = (order.payment ?? {}) as JsonObject;
  const paymentReference = normalizeStatus(payment.reference, '');
  const { data: existingTransaction, error: lookupError } = await serviceClient
    .from('PaymentTransaction')
    .select('id,splitSubaccountCode,settlementMode')
    .eq('reference', paymentReference)
    .maybeSingle<{ id: string; settlementMode?: string | null; splitSubaccountCode?: string | null }>();

  if (lookupError) {
    throw new Error(`Failed to resolve payment transaction id: ${lookupError.message}`);
  }

  const payload = {
    id: existingTransaction?.id?.trim() || paymentReference,
    updatedAt: new Date().toISOString(),
    orderId: order.id,
    orderGroupId: order.orderGroupId ?? null,
    customerId: order.customerId,
    restaurantId: order.restaurantId,
    provider: 'paystack',
    method: normalizeStatus(payment.method, 'card'),
    reference: paymentReference,
    currency: normalizeStatus(payment.currency, 'NGN'),
    amount: amountOverride ?? toNumber((order.pricing ?? {}).total, 0),
    splitSubaccountCode:
      typeof payment.splitSubaccountCode === 'string'
        ? payment.splitSubaccountCode
        : existingTransaction?.splitSubaccountCode ?? null,
    settlementMode:
      typeof payment.settlementMode === 'string'
        ? payment.settlementMode
        : existingTransaction?.settlementMode ?? 'manual',
    status: paymentStatus,
    accessCode: typeof payment.accessCode === 'string' ? payment.accessCode : null,
    authorizationUrl: typeof payment.authorizationUrl === 'string' ? payment.authorizationUrl : null,
    externalTransactionId:
      transactionData.id === null || transactionData.id === undefined ? null : String(transactionData.id),
    channel: typeof transactionData.channel === 'string' ? transactionData.channel : null,
    gatewayStatus:
      typeof transactionData.gateway_response === 'string'
        ? transactionData.gateway_response
        : typeof transactionData.status === 'string'
          ? transactionData.status
          : null,
    lastError:
      paymentStatus === 'failed'
        ? typeof transactionData.message === 'string'
          ? transactionData.message
          : typeof transactionData.gateway_response === 'string'
            ? transactionData.gateway_response
            : null
        : null,
    paidAt: paymentStatus === 'paid' ? paidAtOverride ?? new Date().toISOString() : null,
    verifiedAt: new Date().toISOString(),
    initializeResponse: payment.initializeResponse ?? null,
    // The raw gateway answer this verification acted on, from either path.
    verificationResponse: transactionData,
    // Only a webhook delivery carries an event. A refresh-confirmed payment
    // must not null out a payload a webhook already stored.
    ...(webhookEvent ? { webhookEvent } : {}),
  };

  const { error } = await serviceClient.from('PaymentTransaction').upsert(payload, {
    onConflict: 'reference',
  });

  if (error) throw new Error(`Failed to upsert payment transaction: ${error.message}`);
};

// Order statuses in which an order is genuinely waiting on this payment: orders
// are inserted as 'placed' (or 'scheduled') BEFORE they are paid, and stay
// invisible to the kitchen until payment.status is 'paid'. 'draft'/'pending'/
// 'confirmed' are legacy spellings that normalize to the same thing. Anything
// else ('scheduled', accepted and later, or closed) must keep its status.
const AWAITING_PAYMENT_ORDER_STATUSES = ['placed', 'draft', 'pending', 'confirmed'];
// Terminal-without-delivery statuses: money arrived for an order that is
// already dead (typically the unpaid timeout cancelled it first).
const CLOSED_ORDER_STATUSES = new Set(['cancelled', 'rejected', 'failed_delivery']);
// Payment states a verification must never overwrite - a payment never moves
// backwards. 'paid': another verification of this charge (the webhook, a
// customer refresh, a queue retry) already recorded it and sent its
// notifications. 'refunded': the money was handed back, and a later verify of
// the same charge must not resurrect it as paid.
const SETTLED_PAYMENT_STATUSES = new Set(['paid', 'refunded']);
// Paystack verify statuses that mean the charge did not (or no longer) hold.
const UNSUCCESSFUL_GATEWAY_STATUSES = new Set(['abandoned', 'failed', 'reversed']);
// A payment write that loses its compare-and-set is re-judged on the fresh row;
// an order that changes under us this many times in a row is reported, not
// written blind.
const MAX_PAYMENT_WRITE_ATTEMPTS = 3;

const ORDER_STATE_COLUMNS = 'id,customerId,orderGroupId,restaurantId,status,payment,pricing,timeline,updatedAt';

const normalizeOrderStatusText = (value: unknown) => normalizeStatus(value, '').toLowerCase();

const isSettledPayment = (row: Pick<CustomerOrderRow, 'payment'>) =>
  SETTLED_PAYMENT_STATUSES.has(normalizeOrderStatusText((row.payment ?? {}).status));

const loadOrderState = async (orderId: string) => {
  const { data, error } = await serviceClient
    .from('CustomerOrder')
    .select(ORDER_STATE_COLUMNS)
    .eq('id', orderId)
    .maybeSingle<CustomerOrderRow>();

  if (error) throw new Error(`Failed to reload order: ${error.message}`);
  return data ?? null;
};

/**
 * The orders one Paystack charge pays for: the order itself, or every order of
 * its multi-store group (one charge split across restaurants). Each order is
 * judged on its OWN current state - the primary is the row the caller loaded,
 * the others are read here.
 */
const loadChargeOrders = async (order: CustomerOrderRow) => {
  const { data: groupRows, error: groupError } = await serviceClient
    .from('OrderGroup')
    .select('id,orderIds,pricing')
    .eq('id', order.orderGroupId ?? '')
    .maybeSingle<OrderGroupRow>();

  if (groupError) {
    throw new Error(`Failed to load order group: ${groupError.message}`);
  }

  const orderIds = Array.isArray(groupRows?.orderIds)
    ? // A type-predicate filter, not map-to-null + filter(Boolean): the latter
      // drops the same values at runtime but leaves the element type
      // `string | null`, so every orderId below was nullable and could not be
      // handed to broadcastOrderChanged. The `.length > 0` clause preserves
      // filter(Boolean)'s rejection of the empty string exactly.
      (groupRows.orderIds as unknown[]).filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    : [order.id];
  const expectedAmount = typeof groupRows?.pricing === 'object' && groupRows?.pricing
    ? toNumber((groupRows.pricing as JsonObject).total, toNumber((order.pricing ?? {}).total, 0))
    : toNumber((order.pricing ?? {}).total, 0);

  const rowsById = new Map<string, CustomerOrderRow>([[order.id, order]]);
  const peerIds = orderIds.filter((orderId) => orderId !== order.id);
  if (peerIds.length > 0) {
    const { data: peerRows, error: peerError } = await serviceClient
      .from('CustomerOrder')
      .select(ORDER_STATE_COLUMNS)
      .in('id', peerIds)
      .returns<CustomerOrderRow[]>();

    if (peerError) {
      throw new Error(`Failed to load group orders: ${peerError.message}`);
    }
    for (const peer of peerRows ?? []) rowsById.set(peer.id, peer);
  }

  const rows = orderIds
    .map((orderId) => rowsById.get(orderId))
    .filter((row): row is CustomerOrderRow => Boolean(row));
  return { expectedAmount, isGroup: orderIds.length > 1, rows };
};

/**
 * A successful payment landed on an order that is already closed. We do NOT
 * revive it and do NOT refund automatically: the payment is recorded, and a
 * human is pointed at it via the order's needsAttention flag (set by the
 * caller), a DeliveryEvent on the order timeline and a high-severity
 * OperationalAlert. Best-effort - a failure here must never fail the
 * verification, because the money is already captured and recorded.
 */
const flagPaymentOnClosedOrder = async (input: {
  orderId: string;
  orderStatus: string;
  paymentReference: string;
  restaurantId: string;
}) => {
  logEdgeEvent('warn', 'Payment received for a closed order; flagged for manual review', {
    orderId: input.orderId,
    orderStatus: input.orderStatus,
    paymentReference: input.paymentReference,
  });

  try {
    const { error } = await serviceClient.from('DeliveryEvent').insert({
      id: crypto.randomUUID(),
      orderId: input.orderId,
      eventType: 'payment_received_on_closed_order',
      actorUid: null,
      details: {
        orderStatus: input.orderStatus,
        paymentReference: input.paymentReference,
      },
    });
    if (error) console.error(`Failed to record closed-order payment event for ${input.orderId}: ${error.message}`);
  } catch (error) {
    console.error(`Failed to record closed-order payment event for ${input.orderId}`, error);
  }

  await capturePaymentOnClosedOrderAlert(input);
};

// One per order per payment: only the verification that won the payment
// compare-and-set gets here. Best-effort, like the closed-order event - the
// money is recorded, and throwing now would make a retry find the order paid
// and skip the notifications below for good.
const recordPaymentConfirmedEvent = async (input: { amount: number; orderId: string; paymentReference: string }) => {
  try {
    const { error } = await serviceClient.from('DeliveryEvent').insert({
      id: crypto.randomUUID(),
      orderId: input.orderId,
      eventType: 'payment_confirmed',
      actorUid: null,
      details: {
        amount: input.amount,
        provider: 'paystack',
        reference: input.paymentReference,
      },
    });
    if (error) console.error(`Failed to record payment_confirmed event for ${input.orderId}: ${error.message}`);
  } catch (error) {
    console.error(`Failed to record payment_confirmed event for ${input.orderId}`, error);
  }
};

type PaymentClaim = {
  closed: boolean;
  orderId: string;
  orderStatus: string;
  restaurantId: string;
};

/**
 * Records the confirmed charge on ONE order as a compare-and-set on the payment
 * status this call read (and on the order status its decision was made from).
 *
 * This is what makes "one payment, one set of notifications" hold when the
 * webhook and a customer refresh verify the same charge at the same moment:
 * both read 'pending' and both reach this UPDATE, but Postgres takes the row
 * lock for one, and when the other gets it the WHERE is re-evaluated against the
 * committed row - payment.status is now 'paid', zero rows match, and that caller
 * returns null and sends nothing.
 *
 * Returns the claim when THIS call moved the payment, or null when the payment
 * was already settled (paid or refunded) - whoever settled it owns that
 * order's side effects. `row` is the latest state this call saw, which tells
 * the caller whether an order someone else claimed is live or closed.
 */
const claimOrderPayment = async (
  initialRow: CustomerOrderRow,
  buildPaidPayment: (row: CustomerOrderRow) => JsonObject,
  confirmedTimeline: (row: CustomerOrderRow) => JsonObject,
  nowIso: string
): Promise<{ claim: PaymentClaim | null; row: CustomerOrderRow }> => {
  let row = initialRow;
  for (let attempt = 0; attempt < MAX_PAYMENT_WRITE_ATTEMPTS; attempt += 1) {
    if (isSettledPayment(row)) return { claim: null, row };

    const previousPaymentStatus = storedPaymentStatus(row);
    const currentStatus = normalizeOrderStatusText(row.status);
    const awaiting = AWAITING_PAYMENT_ORDER_STATUSES.includes(currentStatus);
    // NOT awaiting payment: record the money, never touch `status`.
    //  - 'scheduled' (and anything already in the kitchen) keeps its status;
    //  - a closed order is flagged for a human, NOT revived and NOT auto-refunded.
    const closed = !awaiting && CLOSED_ORDER_STATUSES.has(currentStatus);

    const update = awaiting
      ? {
          // 'placed' = awaiting restaurant acceptance. 'confirmed' is NOT a valid order
          // status (not in ORDER_STATUSES), so it normalized to 'draft' and disabled the
          // partner's kitchen actions on paid orders.
          status: 'placed',
          payment: buildPaidPayment(row),
          timeline: confirmedTimeline(row),
          updatedAt: nowIso,
        }
      : {
          payment: buildPaidPayment(row),
          timeline: closed
            ? { ...(row.timeline ?? {}), paidAt: nowIso, latePaymentAt: nowIso }
            : confirmedTimeline(row),
          updatedAt: nowIso,
          ...(closed ? { needsAttention: true } : {}),
        };

    let query = serviceClient.from('CustomerOrder').update(update).eq('id', row.id);
    // The order-status half of the guard: the order may have been cancelled
    // (the unpaid timeout) after it was read and before Paystack answered.
    query = awaiting
      ? query.in('status', AWAITING_PAYMENT_ORDER_STATUSES)
      : typeof row.status === 'string'
        ? query.eq('status', row.status)
        : query.is('status', null);
    query = previousPaymentStatus === null
      ? query.is('payment->>status', null)
      : query.eq('payment->>status', previousPaymentStatus);

    const { data: written, error } = await query.select('id');
    if (error) throw new Error(`Failed to update order: ${error.message}`);

    if (Array.isArray(written) && written.length > 0) {
      return {
        claim: { closed, orderId: row.id, orderStatus: currentStatus, restaurantId: row.restaurantId },
        row,
      };
    }

    // Lost the race: judge the order again on its committed state.
    const fresh = await loadOrderState(row.id);
    if (!fresh) return { claim: null, row };
    row = fresh;
  }

  throw new Error(`Order ${initialRow.id} kept changing while its payment was being recorded`);
};

const markOrderPaymentState = async (
  order: CustomerOrderRow,
  transactionData: JsonObject,
  webhookEvent: JsonObject | null
) => {
  const nowIso = new Date().toISOString();
  const payment = (order.payment ?? {}) as JsonObject;
  const paymentReference = normalizeStatus(payment.reference, '');
  const gatewayStatus =
    typeof transactionData.gateway_response === 'string'
      ? transactionData.gateway_response
      : normalizeStatus(transactionData.status, 'success');

  const { expectedAmount, isGroup, rows } = await loadChargeOrders(order);

  const buildPaidPayment = (row: CustomerOrderRow): JsonObject => ({
    ...((row.payment ?? {}) as JsonObject),
    provider: 'paystack',
    status: 'paid',
    reference: paymentReference,
    verifiedAt: nowIso,
    paidAt: nowIso,
    lastEvent: gatewayStatus,
    paystackResponse: transactionData,
    // One order: the charged total, exactly as before. A multi-store group is
    // one charge split across orders, so each order captures its OWN share
    // (refunds are computed per order from this field).
    capturedAmount: isGroup ? toNumber((row.pricing ?? {}).total, expectedAmount) : expectedAmount,
  });

  const confirmedTimeline = (row: CustomerOrderRow): JsonObject => ({
    ...(row.timeline ?? {}),
    paidAt: nowIso,
    confirmedAt: (row.timeline ?? {}).confirmedAt ?? nowIso,
  });

  const claims: PaymentClaim[] = [];
  // Per order of the charge, in orderIds order: whether it is live (not
  // closed), judged from this call's claim or, for an order another caller
  // claimed, from the state this call last saw. Closed is terminal, so every
  // caller reaches the same answer.
  const liveByOrderId = new Map<string, boolean>();
  for (const row of rows) {
    const outcome = await claimOrderPayment(row, buildPaidPayment, confirmedTimeline, nowIso);
    if (outcome.claim) claims.push(outcome.claim);
    liveByOrderId.set(
      row.id,
      outcome.claim
        ? !outcome.claim.closed
        : !CLOSED_ORDER_STATUSES.has(normalizeOrderStatusText(outcome.row.status))
    );
  }

  if (claims.length === 0) {
    // Another verification of this charge got there first and already sent
    // every notification: report the settled state, change nothing.
    const fresh = await loadOrderState(order.id);
    return {
      success: true,
      orderId: order.id,
      paymentStatus: normalizeOrderStatusText((fresh?.payment ?? {}).status) || 'paid',
    };
  }

  for (const claim of claims) {
    if (claim.closed) {
      await flagPaymentOnClosedOrder({
        orderId: claim.orderId,
        orderStatus: claim.orderStatus,
        paymentReference,
        restaurantId: claim.restaurantId,
      });
    } else {
      await recordPaymentConfirmedEvent({
        amount: toNumber(transactionData.amount, 0) / 100,
        orderId: claim.orderId,
        paymentReference,
      });
    }
    await broadcastOrderChanged(claim.orderId, { restaurantId: claim.restaurantId });
  }

  // The ledger is written by EVERY caller that claimed anything: the upsert is
  // idempotent (conflict on reference), and if only one caller wrote it, that
  // caller crashing here would leave paid orders next to a pending ledger row
  // forever - a retry finds every order settled and does nothing.
  await upsertPaymentTransaction(order, transactionData, 'paid', webhookEvent, isGroup ? expectedAmount : undefined);

  // The other charge-level side effects belong to exactly one caller. Two
  // verifications of a group can interleave so that each claims a different
  // order. Risk signals go with the FIRST order of the charge (live or closed,
  // so a payment on a cancelled order is still screened); the customer's push
  // and email go with the first LIVE order, so the customer is told once even
  // when the first order was already closed.
  const claimedIds = new Set(claims.map((claim) => claim.orderId));
  const firstLiveRow = rows.find((row) => liveByOrderId.get(row.id));
  const ownsRiskSignals = rows.length > 0 && claimedIds.has(rows[0].id);
  const ownsCustomerConfirmation = Boolean(firstLiveRow) && claimedIds.has((firstLiveRow as CustomerOrderRow).id);

  if (ownsRiskSignals) {
    await capturePaymentVerificationRiskSignals({
      customerId: order.customerId,
      orderId: order.id,
      paymentReference,
      transactionData,
    });
  }

  // A payment that landed on a cancelled order must not tell the restaurant it
  // has a paid order to prepare, nor tell the customer it will be prepared.
  const liveClaims = claims.filter((claim) => !claim.closed);

  // Every restaurant of a multi-store group has its own paid order to accept,
  // and each order is claimed by exactly one caller, so each is told once.
  for (const claim of liveClaims) {
    const restaurantUsers = await loadRestaurantRecipientUserIds(claim.restaurantId);
    if (restaurantUsers.length > 0) {
      await enqueueNotification(serviceClient, {
        userIds: restaurantUsers,
        payload: {
          title: 'Paid Order Received',
          body: `Order ${claim.orderId} has been paid and is ready for confirmation`,
          data: buildNotificationData({
            app: 'partner',
            orderId: claim.orderId,
            routeKey: 'partner_order_detail',
            type: 'payment_confirmed',
          }),
        },
      });
    }
  }

  if (!ownsCustomerConfirmation) {
    return { success: true, orderId: order.id, paymentStatus: 'paid' };
  }

  // The webhook path is the one that confirms payments the customer walked
  // away from (closed the Paystack sheet, lost signal); it used to send only
  // an email, so the customer had no in-app signal the order went through.
  await enqueueNotification(serviceClient, {
    userIds: [order.customerId],
    payload: {
      title: 'Payment confirmed',
      body: `We received your payment for order ${shortOrderCode(order.id)}. The restaurant has been notified.`,
      data: buildNotificationData({
        app: 'customer',
        orderId: order.id,
        routeKey: 'customer_order_detail',
        type: 'payment_confirmed',
      }),
    },
  }).catch((error) => {
    logEdgeEvent('warn', 'customer payment push could not be queued', {
      error: error instanceof Error ? error.message : String(error),
      orderId: order.id,
    });
  });

  const recipient = await loadUserEmailRecipient(order.customerId);
  if (recipient) {
    await sendTransactionalEmail({
      to: recipient.email,
      subject: `Payment received for order ${shortOrderCode(order.id)}`,
      html: buildTransactionalEmailHtml({
        heading: 'Payment confirmed',
        recipientName: recipient.displayName,
        lines: [
          `We received your payment of ${formatNairaAmount(toNumber((order.pricing ?? {}).total, 0))} for order ${shortOrderCode(order.id)}.`,
          `Reference: ${normalizeStatus((order.payment ?? {}).reference, 'n/a')}.`,
          'The restaurant has been notified and will start preparing your order.',
        ],
      }),
    });
  }

  return { success: true, orderId: order.id, paymentStatus: 'paid' };
};

// A charge Paystack reports as reversed AFTER the order was paid: the money was
// genuinely pulled back. Silently writing 'failed' over 'paid' would hide that
// the kitchen may be cooking an order nobody paid for, so the payment status is
// left alone and a human is pointed at it instead. Once per order: the
// timeline.paymentReversedAt stamp is the guard, so repeated customer refreshes
// do not re-page the admins.
//
// The flag write merges the timeline this call read, so it is guarded on the
// status and updatedAt read as well: a concurrent timeline patch (a status
// change, a late stamp) must not be clobbered by the stale copy. A lost guard is
// re-read and retried once; if it loses again the write is given up and logged,
// but the OperationalAlert and the admin page still go out - the reversal must
// reach a human even when the flag could not be written.
const MAX_REVERSAL_FLAG_ATTEMPTS = 2;

const writeReversalFlag = async (row: CustomerOrderRow, nowIso: string) => {
  let query = serviceClient
    .from('CustomerOrder')
    .update({
      needsAttention: true,
      timeline: { ...(row.timeline ?? {}), paymentReversedAt: nowIso },
      updatedAt: nowIso,
    })
    .eq('id', row.id)
    .eq('payment->>status', 'paid')
    .is('timeline->>paymentReversedAt', null);
  query = typeof row.status === 'string' ? query.eq('status', row.status) : query.is('status', null);
  query = typeof row.updatedAt === 'string' ? query.eq('updatedAt', row.updatedAt) : query.is('updatedAt', null);
  const { data: flagged, error } = await query.select('id');
  if (error) throw new Error(`Failed to flag reversed payment: ${error.message}`);
  return Array.isArray(flagged) && flagged.length > 0;
};

const isUnflaggedReversalCandidate = (row: CustomerOrderRow) =>
  normalizeOrderStatusText((row.payment ?? {}).status) === 'paid' &&
  !normalizeStatus((row.timeline ?? {}).paymentReversedAt, '');

const flagReversedPaidOrder = async (order: CustomerOrderRow, transactionData: JsonObject) => {
  const nowIso = new Date().toISOString();
  const paymentReference = normalizeStatus((order.payment ?? {}).reference, '');

  let row = order;
  let flagged = false;
  for (let attempt = 0; attempt < MAX_REVERSAL_FLAG_ATTEMPTS; attempt += 1) {
    if (await writeReversalFlag(row, nowIso)) {
      flagged = true;
      break;
    }
    // Lost the guard: judge the committed row. Already flagged (another
    // refresh) or no longer paid means there is nothing left to raise.
    const fresh = await loadOrderState(order.id);
    if (!fresh || !isUnflaggedReversalCandidate(fresh)) return;
    row = fresh;
  }

  const orderStatus = normalizeOrderStatusText(row.status);
  if (flagged) {
    logEdgeEvent('warn', 'Paid order reported reversed by Paystack; flagged for manual review', {
      orderId: order.id,
      orderStatus,
      paymentReference,
    });
  } else {
    logEdgeEvent('error', 'Paid order reported reversed by Paystack, but the order kept changing; flag not written', {
      orderId: order.id,
      orderStatus,
      paymentReference,
    });
  }

  await recordOperationalAlert({
    alertType: 'payment_reversed_on_paid_order',
    dedupeKey: `ops:payment_reversed_on_paid_order:${order.id}`,
    details: `Paystack reports the payment (${paymentReference}) for order ${order.id} as reversed, but the order is recorded as paid (status ${orderStatus || 'unknown'}). The payment status was not changed; check the charge and the order manually.`,
    metadata: {
      gatewayResponse: typeof transactionData.gateway_response === 'string' ? transactionData.gateway_response : null,
      orderStatus,
      paymentReference,
      restaurantId: order.restaurantId,
    },
    severity: 'high',
    subjectId: order.id,
    subjectType: 'order',
    title: 'Payment reversed on a paid order',
  });

  await notifyAdmins({
    body: `Paystack reports the payment for order ${shortOrderCode(order.id)} as reversed. The order is still recorded as paid and needs attention.`,
    data: buildNotificationData({
      app: 'admin',
      orderId: order.id,
      restaurantId: order.restaurantId,
      routeKey: 'admin_access',
      type: 'payment_reversed',
    }),
    title: 'Payment reversed on a paid order',
  });

  if (flagged) {
    await broadcastOrderChanged(order.id, { restaurantId: order.restaurantId });
  }
};

/**
 * Folds a Paystack verify that did NOT come back 'success' into the order(s)
 * the charge pays for. Only the customer refresh calls this - the webhook acts
 * on charge.success alone, through handlePaymentVerification.
 *
 * A payment never moves backwards:
 *  - a settled payment (paid / refunded) is left exactly as it is; a 'reversed'
 *    answer on a PAID order is flagged for a human (flagReversedPaidOrder);
 *  - otherwise the payment becomes failed (abandoned / failed / reversed) or
 *    stays pending, as a compare-and-set on the payment status read, so a
 *    confirmation that lands meanwhile is never overwritten.
 */
export const recordUnsuccessfulPaymentVerification = async ({
  orderId,
  transactionData,
}: {
  orderId: string;
  transactionData: JsonObject;
}) => {
  const order = await loadOrderState(orderId);
  if (!order) throw new Error('Order not found');

  const gatewayStatus = normalizeOrderStatusText(transactionData.status) || 'pending';

  if (isSettledPayment(order)) {
    if (gatewayStatus === 'reversed' && normalizeOrderStatusText((order.payment ?? {}).status) === 'paid') {
      await flagReversedPaidOrder(order, transactionData);
    }
    return;
  }

  // A closed order's unpaid payment stays as it was closed: a late 'ongoing'
  // or 'abandoned' answer must not rewrite the order or its ledger row (the
  // unpaid expiry already recorded both as failed).
  const isClosedOrder = (row: CustomerOrderRow) => TERMINAL_ORDER_STATUSES.has(normalizeOrderStatusText(row.status));
  if (isClosedOrder(order)) return;

  const nowIso = new Date().toISOString();
  const nextStatus = UNSUCCESSFUL_GATEWAY_STATUSES.has(gatewayStatus) ? 'failed' : 'pending';
  const channel = typeof transactionData.channel === 'string' ? transactionData.channel : null;
  const { rows } = await loadChargeOrders(order);

  let movedAny = false;
  let primaryPreviousStatus: string | null | undefined;
  for (const row of rows) {
    if (isSettledPayment(row) || isClosedOrder(row)) continue;

    const previousPaymentStatus = storedPaymentStatus(row);
    // Never failed -> pending: a still-ongoing answer does not undo a failure.
    if (nextStatus === 'pending' && normalizeOrderStatusText(previousPaymentStatus) === 'failed') continue;
    const rowPayment = (row.payment ?? {}) as JsonObject;
    const nextPayment = {
      ...rowPayment,
      ...(channel ? { channel } : {}),
      lastEvent: `paystack_${gatewayStatus}`,
      status: nextStatus,
      verifiedAt: nowIso,
      ...(nextStatus === 'failed' ? { failedAt: normalizeStatus(rowPayment.failedAt, nowIso) } : {}),
    };

    let query = serviceClient
      .from('CustomerOrder')
      .update({ payment: nextPayment, updatedAt: nowIso })
      .eq('id', row.id);
    // The order-status guard keeps a cancel that lands meanwhile (the unpaid
    // expiry) from being followed by this write.
    query = typeof row.status === 'string' ? query.eq('status', row.status) : query.is('status', null);
    query = previousPaymentStatus === null
      ? query.is('payment->>status', null)
      : query.eq('payment->>status', previousPaymentStatus);
    const { data: written, error } = await query.select('id');
    if (error) throw new Error(`Failed to update order payment: ${error.message}`);

    // Zero rows: a confirmation or another refresh wrote this payment first,
    // and its write stands.
    if (!Array.isArray(written) || written.length === 0) continue;

    movedAny = true;
    if (row.id === order.id) primaryPreviousStatus = previousPaymentStatus;
    await broadcastOrderChanged(row.id, { restaurantId: row.restaurantId });
  }

  if (!movedAny) return;

  // The ledger follows the order, guarded on its own status so a 'paid' row
  // recorded by a racing confirmation is never overwritten.
  const paymentReference = normalizeStatus((order.payment ?? {}).reference, '');
  if (paymentReference) {
    const gatewayResponse =
      typeof transactionData.gateway_response === 'string' ? transactionData.gateway_response : gatewayStatus;
    const { error: ledgerError } = await serviceClient
      .from('PaymentTransaction')
      .update({
        channel,
        failedAt: nextStatus === 'failed' ? nowIso : null,
        gatewayStatus: gatewayResponse,
        lastError:
          nextStatus === 'failed'
            ? typeof transactionData.message === 'string'
              ? transactionData.message
              : gatewayResponse
            : null,
        status: nextStatus,
        updatedAt: nowIso,
        verificationResponse: transactionData,
        verifiedAt: nowIso,
      })
      .eq('reference', paymentReference)
      // Same rule as the order: failed never goes back to pending.
      .in('status', nextStatus === 'failed' ? ['pending', 'failed'] : ['pending']);
    if (ledgerError) throw new Error(`Failed to update payment transaction: ${ledgerError.message}`);
  }

  const becameFailed =
    nextStatus === 'failed' &&
    primaryPreviousStatus !== undefined &&
    normalizeOrderStatusText(primaryPreviousStatus) !== 'failed';
  // Re-read just before telling the customer: a confirmation that claimed the
  // payment after this failure write (the customer retried and paid) must not
  // be followed by "did not go through".
  const stillUnpaid = becameFailed ? !isSettledPayment((await loadOrderState(order.id)) ?? { payment: null }) : false;
  if (becameFailed && stillUnpaid) {
    await enqueueNotification(serviceClient, {
      userIds: [order.customerId],
      payload: {
        title: 'Payment not completed',
        body: `Payment for order ${shortOrderCode(order.id)} did not go through. Open the order to try again.`,
        data: buildNotificationData({
          app: 'customer',
          orderId: order.id,
          routeKey: 'customer_order_detail',
          type: 'payment_failed',
        }),
      },
    }).catch((error) => {
      logEdgeEvent('warn', 'customer payment-failed push could not be queued', {
        error: error instanceof Error ? error.message : String(error),
        orderId: order.id,
      });
    });
  }
};

/**
 * The ledger half of a charge whose order payment is already settled. The
 * verification that claimed the order writes the ledger AFTER its claim, so a
 * crash (or a throw) between the two leaves a paid order next to a pending (or
 * failed) ledger row, and every retry then finds the order settled. Repaired
 * here from what the claim stored on the order (payment.paystackResponse is the
 * verified Paystack answer it acted on). Skipped when the row already says paid
 * or refunded, so a replay does not rewrite timestamps; the upsert itself is
 * safe to repeat (conflict on reference). Throws, so a failed repair is retried
 * by the caller rather than recorded as done.
 */
const repairSettledChargeLedger = async (
  order: CustomerOrderRow,
  charge: { expectedAmount: number; isGroup: boolean },
  webhookEvent: JsonObject | null,
  fallbackTransaction: JsonObject | null
) => {
  const payment = (order.payment ?? {}) as JsonObject;
  const paymentReference = normalizeStatus(payment.reference, '');
  if (!paymentReference) return;

  const { data: ledger, error } = await serviceClient
    .from('PaymentTransaction')
    .select('status')
    .eq('reference', paymentReference)
    .maybeSingle<{ status?: string | null }>();
  if (error) throw new Error(`Failed to read payment transaction: ${error.message}`);
  if (ledger && SETTLED_PAYMENT_STATUSES.has(normalizeOrderStatusText(ledger.status))) return;

  const storedResponse = payment.paystackResponse;
  const transactionData =
    storedResponse && typeof storedResponse === 'object' && !Array.isArray(storedResponse)
      ? (storedResponse as JsonObject)
      : fallbackTransaction ?? {};
  logEdgeEvent('warn', 'Settled order had an unsettled payment transaction; repairing the ledger', {
    ledgerStatus: ledger?.status ?? null,
    orderId: order.id,
    paymentReference,
  });
  await upsertPaymentTransaction(
    order,
    transactionData,
    'paid',
    webhookEvent,
    charge.isGroup ? charge.expectedAmount : undefined,
    typeof payment.paidAt === 'string' ? payment.paidAt : undefined
  );
};

/**
 * Verify a Paystack payment for an order.
 *
 * This handler is idempotent and does NOT manage its own queue row lifecycle —
 * the queue-drainer owns finalization (and the paystack-webhook calls it
 * directly, without a queue row at all). On success it returns a result; on
 * failure it throws and lets the caller decide what to do.
 *
 * Idempotency lets the drainer safely reclaim stale `processing` jobs and lets
 * Paystack redeliver the webhook without double-processing. We guard on:
 *   1. An IdempotencyRecord keyed on order id + payment reference.
 *   2. The order's own payment status — if it is already `paid` (or
 *      `refunded`), we skip re-verification and (importantly) the
 *      re-notification side effect. What a crashed claimer left undone is
 *      still finished: its ledger row is repaired, and unclaimed group
 *      siblings are verified and claimed (and only they are notified).
 *   3. A compare-and-set on that payment status when writing (see
 *      claimOrderPayment), which is what actually holds when two
 *      verifications of the same charge - the webhook and a customer refresh -
 *      both pass check 2 at the same moment.
 *
 * The customer refresh (refreshCustomerPaymentStatus) comes through here too,
 * passing the verify answer it already has, so a payment confirmed either way
 * gets the same closed-order safeguard and exactly one set of notifications.
 */
export const handlePaymentVerification = async (job: PaymentVerificationRequest) => {
  const { orderId, paymentReference, webhookEvent = null, verifiedTransaction: prefetchedTransaction = null } = job;
  const idempotencyKey = `payment_verification:${orderId}:${paymentReference}`;

  const existingRecord = await getIdempotencyRecord(serviceClient, idempotencyKey);
  if (existingRecord?.response) {
    await capturePaymentVerificationReplaySignal({
      orderId,
      paymentReference,
    });
    return existingRecord.response as { success: boolean; orderId: string; paymentStatus: string };
  }

  const { data: order, error: orderError } = await serviceClient
    .from('CustomerOrder')
    .select('*')
    .eq('id', orderId)
    .single<CustomerOrderRow>();

  if (orderError || !order) throw new Error('Order not found');

  // Settled: another verification claimed this order. If it crashed partway,
  // finish its work here - but send nothing for what it claimed (a lost push
  // beats a duplicate). A group sibling it never got to falls through to the
  // full verification below, which claims ONLY the still-unsettled orders, so
  // the sibling claimed on this retry gets its notification and the order
  // claimed earlier gets none (markOrderPaymentState notifies claim winners).
  // A lone order, or a group whose orders are all settled, only gets its
  // ledger repaired.
  let resumeUnclaimedSiblings = false;
  if (isSettledPayment(order)) {
    const charge = order.orderGroupId
      ? await loadChargeOrders(order)
      : { expectedAmount: toNumber((order.pricing ?? {}).total, 0), isGroup: false, rows: [order] };
    resumeUnclaimedSiblings = charge.rows.some((row) => row.id !== order.id && !isSettledPayment(row));
    if (!resumeUnclaimedSiblings) {
      await repairSettledChargeLedger(order, charge, webhookEvent, prefetchedTransaction);
    }
  }

  if (isSettledPayment(order) && !resumeUnclaimedSiblings) {
    await capturePaymentVerificationReplaySignal({
      orderId,
      paymentReference,
    });
    const response = { success: true, orderId, paymentStatus: normalizeOrderStatusText((order.payment ?? {}).status) };
    await storeIdempotencyRecord(
      serviceClient,
      idempotencyKey,
      'payment_verification',
      order.customerId,
      response
    );
    return response;
  }

  const verifiedTransaction = prefetchedTransaction ?? (await verifyPaystackTransaction(paymentReference));

  // Multi-store checkout is ONE charge for the whole group; the order resolved
  // here is only the primary one. Single-store orders carry no orderGroupId, so
  // they skip this lookup entirely and validate exactly as before.
  let expectedTotal: number | undefined;
  if (order.orderGroupId) {
    const { data: group, error: groupError } = await serviceClient
      .from('OrderGroup')
      .select('id,orderCount,pricing')
      .eq('id', order.orderGroupId)
      .maybeSingle<{ id: string; orderCount?: number | null; pricing?: JsonObject | null }>();

    if (groupError) {
      throw new Error(`Failed to load order group: ${groupError.message}`);
    }

    expectedTotal = resolveGroupExpectedTotal(group);
  }

  validatePaystackVerificationForOrder({
    order,
    paymentReference,
    transactionData: verifiedTransaction,
    expectedTotal,
  });

  const result = await markOrderPaymentState(order, verifiedTransaction, webhookEvent);

  await storeIdempotencyRecord(
    serviceClient,
    idempotencyKey,
    'payment_verification',
    order.customerId,
    result
  );

  return result;
};

/**
 * Record a terminal payment-verification failure on the order. Invoked by the
 * queue-drainer once a job has exhausted its retries, preserving the previous
 * "mark the order's payment as failed" behavior without coupling the handler's
 * happy path to the queue's retry bookkeeping.
 */
export const markPaymentVerificationFailed = async (
  orderId: string,
  paymentReference: string,
  message: string,
  retryCount?: number | null
) => {
  const nowIso = new Date().toISOString();

  // Load the order's existing payment blob so the failure update can merge
  // into it (see markOrderPaymentState above) instead of replacing it — a
  // wholesale replace drops `method`/`provider`/`currency`/etc. and makes a
  // failed card order look non-prepaid downstream. Reading the order is
  // best-effort: if it fails the failure signal is still captured, and we
  // never throw past the caller (see doc comment).
  let existingPayment: JsonObject = {};
  const { data: order, error: orderError } = await serviceClient
    .from('CustomerOrder')
    .select('payment')
    .eq('id', orderId)
    .maybeSingle<{ payment: JsonObject | null }>();

  if (orderError) {
    console.error(`Failed to load order ${orderId} before marking payment failed: ${orderError.message}`);
  } else {
    existingPayment = (order?.payment ?? {}) as JsonObject;
  }

  // Guard against a race where the webhook path already verified this
  // payment (status: 'paid') while a stale queue retry for the same job was
  // still in flight and only fails afterward - or the order was refunded. A
  // payment never moves backwards, so skip the write rather than stamping
  // 'failed' next to a paidAt/paystackResponse that says otherwise.
  if (isSettledPayment({ payment: existingPayment })) {
    console.log(`Skipping payment-failed write for ${orderId}: payment already ${normalizeStatus(existingPayment.status, '')}.`);
  } else if (!orderError) {
    // Compare-and-set on the status just read: a confirmation landing between
    // that read and this write wins. An unreadable order is not written blind.
    const previousPaymentStatus = storedPaymentStatus({ payment: existingPayment });
    let query = serviceClient
      .from('CustomerOrder')
      .update({
        payment: {
          ...existingPayment,
          status: 'failed',
          reference: paymentReference,
          error: message,
          failedAt: nowIso,
        },
        updatedAt: nowIso,
      })
      .eq('id', orderId);
    query = previousPaymentStatus === null
      ? query.is('payment->>status', null)
      : query.eq('payment->>status', previousPaymentStatus);
    const { error } = await query;

    if (error) {
      console.error(`Failed to mark payment failed for ${orderId}: ${error.message}`);
    }
  }

  await capturePaymentVerificationFailureSignal({
    orderId,
    paymentReference,
    reason: message,
    retryCount,
  });
};
