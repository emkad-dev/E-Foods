// A paid order that ends without the food reaching the customer: the restaurant
// rejected it, the rider's delivery failed, an admin cancelled it (a
// force-cancel or the dispatch write-off), the customer cancelled it, or the
// acceptance deadline auto-cancelled it. The customer's money was captured
// and nothing returns it automatically (real Paystack refunds await an owner
// decision), so these paths do what cancellation does - record the full refund
// in the order's payment ledger with buildRefundUpdate - and then make sure a
// human sees it: needsAttention on the same closing write, an OperationalAlert
// for the admin console, and the admin push/email. The promo-cap slot the order
// held is freed, as on every other paid order that ends without being served.
//
// Recorded only: no money moves here. The money is sent either by an admin
// ("Refund via Paystack", adminSendOrderRefund) or, for the clear-cut cases and
// only while the auto_refunds flag is on, by the caller right after this
// announcement (startAutomaticRefund in paystackRefund.ts); the wording below
// says which, so nobody refunds by hand while Paystack is already sending it.

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
 * The fields to merge into the write that closes a PAID order (rejected,
 * failed_delivery, or cancelled by an admin): the full refund recorded exactly as cancellation records it,
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

/**
 * Who closed a cancelled order, for the admin-facing wording only. Omitted means
 * an admin (a force-cancel, the dispatch write-off, or an admin cancelling on the
 * customer's behalf).
 */
export type ManualRefundCancelledBy = 'admin' | 'customer' | 'acceptance_timeout';

const describeClosure = (closedStatus: string, cancelledBy: ManualRefundCancelledBy) => {
  if (closedStatus === ORDER_STATUS.FAILED_DELIVERY) {
    return { short: 'delivery failed on a paid order', verb: 'failed delivery' };
  }
  if (closedStatus === ORDER_STATUS.CANCELLED) {
    if (cancelledBy === 'customer') {
      return { short: 'customer cancelled a paid order', verb: 'was cancelled by the customer' };
    }
    if (cancelledBy === 'acceptance_timeout') {
      return {
        short: 'paid order cancelled unaccepted',
        verb: 'was cancelled automatically because the restaurant did not accept it in time',
      };
    }
    return { short: 'admin cancelled a paid order', verb: 'was cancelled by an admin' };
  }
  return { short: 'restaurant rejected a paid order', verb: 'was rejected by the restaurant' };
};

/**
 * Side effects once the closing write committed (call only when it applied).
 * Never throws: the order is already closed, so a failed alert must not turn the
 * caller's successful action into an error.
 */
export const announceManualRefund = async (input: {
  actorUid: string;
  /** The caller will send this refund through Paystack automatically right after. */
  autoRefund?: boolean;
  /** Only read when closedStatus is cancelled; defaults to an admin. */
  cancelledBy?: ManualRefundCancelledBy;
  closedStatus: string;
  order: CustomerOrderRow;
  payment: JsonObject;
}) => {
  const { actorUid, closedStatus, order, payment } = input;

  await releasePromoRedemption(order.id);

  // Everything that formats or sends is inside the try, so nothing here throws.
  try {
    const code = shortOrderCode(order.id);
    const closure = describeClosure(closedStatus, input.cancelledBy ?? 'admin');
    const refundAmount = typeof payment.refundAmount === 'number' ? payment.refundAmount : null;
    // buildRefundUpdate records nothing for a payment it cannot refund (not a
    // prepaid method, or no captured amount). Say so rather than claim a refund.
    const refundRecorded = payment.status === PAYMENT_STATUS.REFUNDED && refundAmount !== null;
    const autoRefund = input.autoRefund === true && refundRecorded;
    const details = autoRefund
      ? `Order ${order.id} ${closure.verb} after payment. A refund of ${formatNairaAmount(
          refundAmount
        )} is recorded and FEASTY is sending it through Paystack automatically: do not refund by hand unless a "Refund failed" or "Refund needs attention" alert follows.`
      : refundRecorded
        ? `Order ${order.id} ${closure.verb} after payment. A refund of ${formatNairaAmount(
            refundAmount
          )} is recorded on the order but no money has moved: send it with "Refund via Paystack" on the order, or return it to the customer by hand.`
        : `Order ${order.id} ${closure.verb} after payment. No refund could be recorded automatically: check the payment and return the money to the customer by hand.`;
    const adminBody = autoRefund
      ? `Order ${code} ${closure.verb} after payment. The refund is being sent through Paystack automatically.`
      : refundRecorded
        ? `Order ${code} ${closure.verb} after payment. The refund is recorded: send it with "Refund via Paystack" or pay it back by hand.`
        : `Order ${code} ${closure.verb} after payment. No refund could be recorded automatically; check the payment by hand.`;

    await recordOperationalAlert({
      alertType: MANUAL_REFUND_ALERT_TYPE,
      dedupeKey: `ops:${MANUAL_REFUND_ALERT_TYPE}:${order.id}`,
      details,
      metadata: {
        actorUid,
        autoRefund,
        closedStatus,
        paymentReference: typeof payment.reference === 'string' ? payment.reference : null,
        refundAmount,
        restaurantId: order.restaurantId,
      },
      severity: 'high',
      subjectId: order.id,
      subjectType: 'order',
      title: autoRefund ? `Refund sending: ${closure.short}` : `Refund needed: ${closure.short}`,
    });

    await notifyAdmins({
      body: adminBody,
      data: buildNotificationData({
        app: 'admin',
        orderId: order.id,
        restaurantId: order.restaurantId,
        routeKey: 'admin_access',
        type: MANUAL_REFUND_ALERT_TYPE,
      }),
      title: autoRefund ? `Refund sending: ${closure.short}` : `Refund needed: ${closure.short}`,
    });
  } catch (error) {
    logEdgeEvent('error', 'manual refund alert failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId: order.id,
    });
  }
};
