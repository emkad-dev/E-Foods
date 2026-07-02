/// <reference path="../_shared/edge-runtime.d.ts" />

import { serviceClient } from '../_shared/client.ts';
import { enqueueNotification, incrementRetry, updateJobStatus } from '../_shared/queue.ts';
import type { PaymentVerificationJob } from '../_shared/queue.ts';
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

const verifyPaystackTransaction = async (reference: string) => {
  const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!paystackSecretKey) throw new Error('PAYSTACK_SECRET_KEY not configured');

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${paystackSecretKey}`,
    },
  });

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

  const payload = {
    orderId: order.id,
    customerId: order.customerId,
    restaurantId: order.restaurantId,
    provider: 'paystack',
    method: normalizeStatus(payment.method, 'card'),
    reference: normalizeStatus(payment.reference, ''),
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
      status: 'confirmed',
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

export const handlePaymentVerification = async (job: PaymentVerificationRequest) => {
  const { orderId, paymentReference, webhookEvent = null } = job;

  try {
    const { data: order, error: orderError } = await serviceClient
      .from('CustomerOrder')
      .select('*')
      .eq('id', orderId)
      .single<CustomerOrderRow>();

    if (orderError || !order) throw new Error('Order not found');

    const verifiedTransaction = await verifyPaystackTransaction(paymentReference);
    validatePaystackVerificationForOrder({
      order,
      paymentReference,
      transactionData: verifiedTransaction,
    });

    const result = await markOrderPaymentState(order, verifiedTransaction, webhookEvent);

    await updateJobStatus(serviceClient, 'payment-verification', orderId, 'completed', {
      orderId,
      status: 'confirmed',
      paymentStatus: 'paid',
    });

    return result;
  } catch (error: any) {
    console.error('Payment verification error:', error.message);

    const canRetry = await incrementRetry(serviceClient, 'payment-verification', orderId, 5);
    if (canRetry) {
      await updateJobStatus(serviceClient, 'payment-verification', orderId, 'pending');
      throw new Error(`Payment verification failed, will retry: ${error.message}`);
    }

    await serviceClient
      .from('CustomerOrder')
      .update({
        payment: {
          status: 'failed',
          reference: paymentReference,
          error: error.message,
          failedAt: new Date().toISOString(),
        },
      })
      .eq('id', orderId);

    await broadcastOrderChanged(orderId);

    await updateJobStatus(
      serviceClient,
      'payment-verification',
      orderId,
      'failed',
      undefined,
      error.message
    );

    throw error;
  }
};
