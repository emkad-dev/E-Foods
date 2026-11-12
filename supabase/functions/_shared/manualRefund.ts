// A paid order that ends without the food reaching the customer: the restaurant
// rejected it, or the rider's delivery failed. The customer's money was captured
// and nothing returns it automatically (real Paystack refunds await an owner
// decision), so these paths do what cancellation does - record the full refund
// in the order's payment ledger with buildRefundUpdate - and then make sure a
// human sees it: needsAttention on the same closing write, an OperationalAlert
// for the admin console, and the admin push/email. The promo-cap slot the order
// held is freed, as on every other paid order that ends without being served.
//
// Recorded only: no money moves here and the customer copy is unchanged.

import { buildRefundUpdate } from './domains/orders.ts';
import { formatNairaAmount, shortOrderCode } from './email.ts';
import { buildNotificationData, notifyAdmins } from './notifications.ts';
import { logEdgeEvent } from './observability.ts';
import { recordOperationalAlert } from './operationalAlerts.ts';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  releasePromoRedemption,
  storedPaymentStatus,
  type CustomerOrderRow,
} from './orders.ts';
import type { JsonObject } from './rpc/coercion.ts';

export const MANUAL_REFUND_ALERT_TYPE = 'manual_refund_required';

/**
 * The fields to merge into the write that closes a PAID order (rejected or
 * failed_delivery): the full refund recorded exactly as cancellation records it,
 * and needsAttention raised in the same statement (which also stops the
 * terminal-status attention clear from undoing it). Null when the stored payment
 * is not paid: nothing was captured, so the close stays as it always was.
 */
export const buildManualRefundWrite = (
  order: CustomerOrderRow,
  reason: string
): { needsAttention: true; payment: JsonObject } | null => {
  if (storedPaymentStatus(order) !== PAYMENT_STATUS.PAID) {
    return null;
  }
  return {
    needsAttention: true,
    payment: buildRefundUpdate({ order, refundRate: 1, reason }) as JsonObject,
  };
};

const describeClosure = (closedStatus: string) =>
  closedStatus === ORDER_STATUS.FAILED_DELIVERY
    ? { short: 'delivery failed on a paid order', verb: 'failed delivery' }
    : { short: 'restaurant rejected a paid order', verb: 'was rejected by the restaurant' };

/**
 * Side effects once the closing write committed (call only when it applied).
 * Never throws: the order is already closed, so a failed alert must not turn the
 * caller's successful action into an error.
 */
export const announceManualRefund = async (input: {
  actorUid: string;
  closedStatus: string;
  order: CustomerOrderRow;
  payment: JsonObject;
}) => {
  const { actorUid, closedStatus, order, payment } = input;
  const code = shortOrderCode(order.id);
  const refundAmount = typeof payment.refundAmount === 'number' ? payment.refundAmount : null;
  const closure = describeClosure(closedStatus);

  await releasePromoRedemption(order.id);

  try {
    await recordOperationalAlert({
      alertType: MANUAL_REFUND_ALERT_TYPE,
      dedupeKey: `ops:${MANUAL_REFUND_ALERT_TYPE}:${order.id}`,
      details: `Order ${order.id} ${closure.verb} after payment. A full refund${
        refundAmount === null ? '' : ` of ${formatNairaAmount(refundAmount)}`
      } is recorded on the order but no money has moved: return it to the customer by hand.`,
      metadata: {
        actorUid,
        closedStatus,
        paymentReference: typeof payment.reference === 'string' ? payment.reference : null,
        refundAmount,
        restaurantId: order.restaurantId,
      },
      severity: 'high',
      subjectId: order.id,
      subjectType: 'order',
      title: `Refund needed: ${closure.short}`,
    });

    await notifyAdmins({
      body: `Order ${code} ${closure.verb} after payment. The refund is recorded but must be paid back by hand.`,
      data: buildNotificationData({
        app: 'admin',
        orderId: order.id,
        restaurantId: order.restaurantId,
        routeKey: 'admin_access',
        type: MANUAL_REFUND_ALERT_TYPE,
      }),
      title: `Refund needed: ${closure.short}`,
    });
  } catch (error) {
    logEdgeEvent('error', 'manual refund alert failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId: order.id,
    });
  }
};
