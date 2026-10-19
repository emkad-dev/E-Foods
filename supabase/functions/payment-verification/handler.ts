/// <reference path="../_shared/edge-runtime.d.ts" />

import { serviceClient } from '../_shared/client.ts';
import { enqueueNotification } from '../_shared/queue.ts';
import type { PaymentVerificationJob } from '../_shared/queue.ts';
import { getIdempotencyRecord, storeIdempotencyRecord } from '../_shared/idempotency.ts';
import {
  buildNotificationData,
  loadRestaurantRecipientUserIds,
} from '../_shared/notifications.ts';
import { broadcastOrderChanged } from '../_shared/realtime.ts';
import { logEdgeEvent } from '../_shared/observability.ts';
import { capturePaymentOnClosedOrderAlert } from '../_shared/operationalAlerts.ts';
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
};

type OrderGroupRow = {
  id: string;
  orderIds?: JsonObject | null;
  pricing?: JsonObject | null;
};

export type PaymentVerificationRequest = PaymentVerificationJob & {
  webhookEvent?: JsonObject | null;
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
  amountOverride?: number
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
    paidAt: paymentStatus === 'paid' ? new Date().toISOString() : null,
    verifiedAt: new Date().toISOString(),
    initializeResponse: payment.initializeResponse ?? null,
    webhookEvent,
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
// already dead (typically the 15-minute unpaid timeout cancelled it first).
const CLOSED_ORDER_STATUSES = new Set(['cancelled', 'rejected', 'failed_delivery']);

const ORDER_STATE_COLUMNS = 'id,customerId,orderGroupId,restaurantId,status,payment,pricing,timeline';

const normalizeOrderStatusText = (value: unknown) => normalizeStatus(value, '').toLowerCase();

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

const markOrderPaymentState = async (
  order: CustomerOrderRow,
  transactionData: JsonObject,
  webhookEvent: JsonObject | null
) => {
  const nowIso = new Date().toISOString();
  const payment = (order.payment ?? {}) as JsonObject;
  const gatewayStatus =
    typeof transactionData.gateway_response === 'string'
      ? transactionData.gateway_response
      : normalizeStatus(transactionData.status, 'success');

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

  const isGroup = orderIds.length > 1;

  // Each order in the group is judged on its OWN current state. The primary
  // order is the row this handler already loaded; the others are read here.
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

  const buildPaidPayment = (row: CustomerOrderRow): JsonObject => ({
    ...((row.payment ?? {}) as JsonObject),
    provider: 'paystack',
    status: 'paid',
    reference: normalizeStatus(payment.reference, ''),
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

  let primaryClosed = false;

  for (const orderId of orderIds) {
    let row = rowsById.get(orderId);
    if (!row) continue;

    if (AWAITING_PAYMENT_ORDER_STATUSES.includes(normalizeOrderStatusText(row.status))) {
      const awaitingUpdate = {
        // 'placed' = awaiting restaurant acceptance. 'confirmed' is NOT a valid order
        // status (not in ORDER_STATUSES), so it normalized to 'draft' and disabled the
        // partner's kitchen actions on paid orders.
        status: 'placed',
        payment: buildPaidPayment(row),
        timeline: confirmedTimeline(row),
        updatedAt: nowIso,
      };

      // Compare-and-set on the status: the order may have been cancelled (the
      // 15-minute unpaid timeout) after it was read and before Paystack answered.
      const { data: advanced, error } = await serviceClient
        .from('CustomerOrder')
        .update(awaitingUpdate)
        .eq('id', orderId)
        .in('status', AWAITING_PAYMENT_ORDER_STATUSES)
        .select('id');

      if (error) throw new Error(`Failed to update order: ${error.message}`);

      if (Array.isArray(advanced) && advanced.length > 0) {
        await broadcastOrderChanged(orderId, { restaurantId: row.restaurantId });
        continue;
      }

      // Lost the race: judge the order on its current state instead.
      const { data: fresh, error: freshError } = await serviceClient
        .from('CustomerOrder')
        .select(ORDER_STATE_COLUMNS)
        .eq('id', orderId)
        .maybeSingle<CustomerOrderRow>();

      if (freshError) throw new Error(`Failed to reload order: ${freshError.message}`);
      if (!fresh) continue;
      row = fresh;

      if (AWAITING_PAYMENT_ORDER_STATUSES.includes(normalizeOrderStatusText(row.status))) {
        // Still awaiting (the guarded update simply reported no rows): fall back
        // to the plain unconditional advance.
        const { error: plainError } = await serviceClient
          .from('CustomerOrder')
          .update({ ...awaitingUpdate, payment: buildPaidPayment(row), timeline: confirmedTimeline(row) })
          .eq('id', orderId);

        if (plainError) throw new Error(`Failed to update order: ${plainError.message}`);
        await broadcastOrderChanged(orderId, { restaurantId: row.restaurantId });
        continue;
      }
    }

    // NOT awaiting payment: record the money, never touch `status`.
    //  - 'scheduled' (and anything already in the kitchen) keeps its status;
    //  - a closed order is flagged for a human, NOT revived and NOT auto-refunded.
    const currentStatus = normalizeOrderStatusText(row.status);
    const closed = CLOSED_ORDER_STATUSES.has(currentStatus);
    if (orderId === order.id) primaryClosed = closed;

    const { error } = await serviceClient
      .from('CustomerOrder')
      .update({
        payment: buildPaidPayment(row),
        timeline: closed
          ? { ...(row.timeline ?? {}), paidAt: nowIso, latePaymentAt: nowIso }
          : confirmedTimeline(row),
        updatedAt: nowIso,
        ...(closed ? { needsAttention: true } : {}),
      })
      .eq('id', orderId);

    if (error) throw new Error(`Failed to update order: ${error.message}`);

    if (closed) {
      await flagPaymentOnClosedOrder({
        orderId,
        orderStatus: currentStatus,
        paymentReference: normalizeStatus(payment.reference, ''),
        restaurantId: row.restaurantId,
      });
    }

    await broadcastOrderChanged(orderId, { restaurantId: row.restaurantId });
  }

  await upsertPaymentTransaction(order, transactionData, 'paid', webhookEvent, isGroup ? expectedAmount : undefined);

  await capturePaymentVerificationRiskSignals({
    customerId: order.customerId,
    orderId: order.id,
    paymentReference: normalizeStatus(payment.reference, ''),
    transactionData,
  });

  // A payment that landed on a cancelled order must not tell the restaurant it
  // has a paid order to prepare, nor tell the customer it will be prepared.
  if (primaryClosed) {
    return { success: true, orderId: order.id, paymentStatus: 'paid' };
  }

  const restaurantUsers = await loadRestaurantRecipientUserIds(order.restaurantId);
  if (restaurantUsers.length > 0) {
    await enqueueNotification(serviceClient, {
      userIds: restaurantUsers,
      payload: {
        title: 'Paid Order Received',
        body: `Order ${order.id} has been paid and is ready for confirmation`,
        data: buildNotificationData({
          app: 'partner',
          orderId: order.id,
          routeKey: 'partner_order_detail',
          type: 'payment_confirmed',
        }),
      },
    });
  }

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
 *   2. The order's own payment status — if it is already `paid`, we skip
 *      re-verification and (importantly) the re-notification side effect.
 */
export const handlePaymentVerification = async (job: PaymentVerificationRequest) => {
  const { orderId, paymentReference, webhookEvent = null } = job;
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

  const currentPayment = (order.payment ?? {}) as JsonObject;
  if (normalizeStatus(currentPayment.status, '') === 'paid') {
    await capturePaymentVerificationReplaySignal({
      orderId,
      paymentReference,
    });
    const response = { success: true, orderId, paymentStatus: 'paid' };
    await storeIdempotencyRecord(
      serviceClient,
      idempotencyKey,
      'payment_verification',
      order.customerId,
      response
    );
    return response;
  }

  const verifiedTransaction = await verifyPaystackTransaction(paymentReference);

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
  // best-effort: if it fails we still record the failure, just without prior
  // fields to preserve, and we never throw past the caller (see doc comment).
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
  // still in flight and only fails afterward. Reading the row above makes
  // this check nearly free, so skip the write rather than stamping 'failed'
  // next to a paidAt/paystackResponse that says otherwise.
  if (normalizeStatus(existingPayment.status, '') === 'paid') {
    console.log(`Skipping payment-failed write for ${orderId}: payment already marked paid.`);
    return;
  }

  const { error } = await serviceClient
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

  if (error) {
    console.error(`Failed to mark payment failed for ${orderId}: ${error.message}`);
  }

  await capturePaymentVerificationFailureSignal({
    orderId,
    paymentReference,
    reason: message,
    retryCount,
  });
};
