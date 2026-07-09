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
import {
  buildTransactionalEmailHtml,
  formatNairaAmount,
  loadUserEmailRecipient,
  sendTransactionalEmail,
  shortOrderCode,
} from '../_shared/email.ts';
import {
  toKoboAmount,
  toNumber,
  validatePaystackVerificationForOrder,
} from './invariants.ts';

type JsonObject = Record<string, unknown>;

type CustomerOrderRow = {
  id: string;
  customerId: string;
  restaurantId: string;
  status: string | null;
  payment: JsonObject | null;
  pricing: JsonObject | null;
  timeline: JsonObject | null;
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
  webhookEvent: JsonObject | null
) => {
  const payment = (order.payment ?? {}) as JsonObject;
  const paymentReference = normalizeStatus(payment.reference, '');
  const { data: existingTransaction, error: lookupError } = await serviceClient
    .from('PaymentTransaction')
    .select('id')
    .eq('reference', paymentReference)
    .maybeSingle<{ id: string }>();

  if (lookupError) {
    throw new Error(`Failed to resolve payment transaction id: ${lookupError.message}`);
  }

  const payload = {
    id: existingTransaction?.id?.trim() || paymentReference,
    updatedAt: new Date().toISOString(),
    orderId: order.id,
    customerId: order.customerId,
    restaurantId: order.restaurantId,
    provider: 'paystack',
    method: normalizeStatus(payment.method, 'card'),
    reference: paymentReference,
    currency: normalizeStatus(payment.currency, 'NGN'),
    amount: toNumber((order.pricing ?? {}).total, 0),
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

  const nextPayment: JsonObject = {
    ...payment,
    provider: 'paystack',
    status: 'paid',
    reference: normalizeStatus(payment.reference, ''),
    verifiedAt: nowIso,
    paidAt: nowIso,
    lastEvent: gatewayStatus,
    paystackResponse: transactionData,
  };

  const nextTimeline: JsonObject = {
    ...(order.timeline ?? {}),
    paidAt: nowIso,
    confirmedAt: (order.timeline ?? {}).confirmedAt ?? nowIso,
  };

  const { error } = await serviceClient
    .from('CustomerOrder')
    .update({
      // 'placed' = awaiting restaurant acceptance. 'confirmed' is NOT a valid order
      // status (not in ORDER_STATUSES), so it normalized to 'draft' and disabled the
      // partner's kitchen actions on paid orders.
      status: 'placed',
      payment: nextPayment,
      timeline: nextTimeline,
      updatedAt: nowIso,
    })
    .eq('id', order.id);

  if (error) throw new Error(`Failed to update order: ${error.message}`);

  await broadcastOrderChanged(order.id, { restaurantId: order.restaurantId });

  await upsertPaymentTransaction(order, transactionData, 'paid', webhookEvent);

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
  validatePaystackVerificationForOrder({
    order,
    paymentReference,
    transactionData: verifiedTransaction,
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
  message: string
) => {
  const nowIso = new Date().toISOString();

  const { error } = await serviceClient
    .from('CustomerOrder')
    .update({
      payment: {
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
};
