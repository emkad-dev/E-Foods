// The admin way out for stuck orders (order-flow fixes, Spec 10). Before these
// there was no admin action that could cancel or complete a pickup past
// accepted, or close a customer problem report, so orders such as fdc652fa sat
// in the kitchen or flagged forever.
//
//   adminForceCancelOrder   - any status that has not ended. A PAID order gets
//                             the full refund recorded and needsAttention raised
//                             through _shared/manualRefund.ts, like a paid
//                             rejection; an unpaid one is simply cancelled.
//   adminForceCompleteOrder - pickups and restaurant-run deliveries from the
//                             kitchen stages, a FEASTY rider delivery only from
//                             on_the_way. Starts the same customer-confirmation
//                             clock the partner `delivered` action starts, so the
//                             customer can still confirm or report.
//   adminResolveOrderReport - clears the flag a customer report raised, notes
//                             the resolution, and closes the confirmation flow
//                             the way the 3-hour auto-close does.
//
// Every write is a compare-and-set on what this request read, so a concurrent
// partner, rider, customer or sweep write wins and this request changes nothing
// (409). Each applied action is audited (AdminAuditLog, not best-effort) and
// leaves a DeliveryEvent carrying the admin's note for the order timeline.
// Recorded only: no money moves and Paystack is never called.

import {
  ADMIN_ORDER_NOTE_MAX_LENGTH,
  canAdminForceCancelOrder,
  canAdminForceCompleteOrder,
  canAdminResolveOrderReport,
} from '../../../packages/domain/src/adminOrders.ts';
import { createAuditEntry } from './auditLog.ts';
import { serviceClient } from './client.ts';
import { CUSTOMER_CONFIRM_WINDOW_MS } from './customerConfirmation.ts';
import { readOrderDeliveryProvider } from './deliveryProvider.ts';
import { releaseDispatchAssignmentLoad } from './dispatchSelection.ts';
import { announceManualRefund, buildManualRefundWrite } from './manualRefund.ts';
import {
  buildNotificationData,
  customerOrderStatusCopy,
  notifyRestaurantUsers,
  notifyUsers,
} from './notifications.ts';
import { logEdgeEvent } from './observability.ts';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  assertOrderPaymentReadyForOperations,
  insertDeliveryEvent,
  loadOrderBundle,
  normalizeOrderStatus,
  releasePromoRedemption,
  storedPaymentStatus,
  updateOrderRecordIfStatus,
  type DeliveryAssignmentRow,
} from './orders.ts';
import { broadcastOrderChanged } from './realtime.ts';
import { nowIso, sanitizeText, type JsonObject } from './rpc/coercion.ts';
import { ensureRole, type AuthenticatedRequestContext } from './rpc/context.ts';
import type { RpcHandler } from './rpc/registry.ts';
import { fail, json } from './rpc/respond.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

const CHANGED_MESSAGE = 'This order changed while you were updating it. Reload the order and try again.';

const parseOrderId = (value: unknown): string => {
  const orderId = sanitizeText(value);
  if (!orderId || orderId.length > 128) {
    fail(400, 'An order id is required.');
  }
  return orderId;
};

/**
 * The admin's reason or note: trimmed, control characters stripped (tab and
 * newline kept) before measuring, so the cap applies to what is stored and
 * shown - the same treatment the customer problem report gets.
 */
export const parseAdminOrderNote = (value: unknown, label: string): string => {
  // deno-lint-ignore no-control-regex
  const text = sanitizeText(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text) {
    fail(400, `A ${label} is required.`);
  }
  if (text.length > ADMIN_ORDER_NOTE_MAX_LENGTH) {
    fail(400, `Please keep the ${label} to ${ADMIN_ORDER_NOTE_MAX_LENGTH} characters or fewer.`);
  }
  return text;
};

const loadOrderForAdmin = async (orderId: string) => {
  const bundle = await loadOrderBundle(orderId);
  if (!bundle) {
    fail(404, 'Order not found.');
  }
  return bundle!;
};

// Best-effort after the status write committed: a failed release must not turn
// a done action into an error (same discipline as every other terminal path).
const releaseRiderLoad = async (orderId: string, status: string) => {
  try {
    await releaseDispatchAssignmentLoad(orderId);
  } catch (error) {
    logEdgeEvent('error', 'dispatch load release failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
      status,
    });
  }
};

const notifyCarryingCourier = async (
  assignment: DeliveryAssignmentRow | null,
  orderId: string,
  status: string,
  title: string,
  body: string
) => {
  const courierId = sanitizeText(assignment?.courierId);
  if (!courierId) {
    return;
  }
  await notifyUsers([courierId], {
    title,
    body,
    data: buildNotificationData({
      app: 'dispatch',
      orderId,
      routeKey: 'dispatch_delivery_detail',
      status,
      type: 'order_update',
    }),
  });
};

export const adminForceCancelOrder: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const orderId = parseOrderId(data.orderId);
  const reason = parseAdminOrderNote(data.reason, 'reason');

  const { assignment, order } = await loadOrderForAdmin(orderId);
  const observedStatus = sanitizeText(order.status);
  const previousStatus = normalizeOrderStatus(observedStatus);
  if (!canAdminForceCancelOrder({ status: previousStatus })) {
    fail(412, 'This order has already ended and cannot be cancelled.');
  }

  // Paid: the full refund recorded and the flag raised on the same write.
  // Unpaid: nothing was captured, so nothing is recorded and the terminal write
  // clears any stale flag (an escalated, never-paid order).
  const manualRefund = buildManualRefundWrite(order, 'admin_force_cancel_full_refund');
  const cancelledAt = nowIso();
  const applied = await updateOrderRecordIfStatus(
    orderId,
    observedStatus,
    {
      ...(manualRefund ?? {}),
      // Same shape the other cancellation paths write. The admin's reason is
      // kept off this record (customers read it) and goes to the audit log and
      // the order timeline event instead.
      cancellation: manualRefund
        ? { actor: 'admin', reason: 'admin_force_cancel', refundRate: 1 }
        : { actor: 'admin', reason: 'admin_force_cancel' },
      status: ORDER_STATUS.CANCELLED,
      timeline: { ...(order.timeline ?? {}), cancelledAt },
      updatedAt: cancelledAt,
    },
    // The refund (or its absence) was decided from the payment this request read.
    { expectedPaymentStatus: storedPaymentStatus(order) }
  );
  if (!applied) {
    fail(409, CHANGED_MESSAGE);
  }

  const payment = (manualRefund?.payment ?? order.payment ?? {}) as JsonObject;
  const refundRecorded = payment.status === PAYMENT_STATUS.REFUNDED && manualRefund !== null;

  await createAuditEntry(context.uid, 'order_force_cancelled', 'order', orderId, {
    previousStatus,
    reason,
    refundRecorded,
    wasPaid: manualRefund !== null,
  });

  if (manualRefund) {
    // Releases the promo slot, records the one OperationalAlert and tells admins.
    await announceManualRefund({
      actorUid: context.uid,
      closedStatus: ORDER_STATUS.CANCELLED,
      order,
      payment,
    });
  } else {
    await releasePromoRedemption(orderId);
  }

  await releaseRiderLoad(orderId, ORDER_STATUS.CANCELLED);

  await insertDeliveryEvent({
    actorUid: context.uid,
    details: { previousStatus, refundRecorded },
    eventType: 'admin_force_cancelled',
    note: reason,
    orderId,
  });

  // The existing cancellation wording on every channel. Nothing here says the
  // money was returned: the refund is recorded only.
  await notifyUsers([order.customerId], {
    ...customerOrderStatusCopy(ORDER_STATUS.CANCELLED, orderId),
    data: buildNotificationData({
      app: 'customer',
      orderId,
      routeKey: 'customer_order_detail',
      status: ORDER_STATUS.CANCELLED,
      type: 'order_update',
    }),
  });
  await notifyRestaurantUsers(order.restaurantId, {
    title: 'Order cancelled',
    body: `Order ${orderId.slice(-6).toUpperCase()} was cancelled by admin.`,
    data: buildNotificationData({
      app: 'partner',
      orderId,
      routeKey: 'partner_order_detail',
      status: ORDER_STATUS.CANCELLED,
      type: 'order_update',
    }),
  });
  await notifyCarryingCourier(
    assignment,
    orderId,
    ORDER_STATUS.CANCELLED,
    'Delivery cancelled',
    `Order ${orderId.slice(-6).toUpperCase()} was cancelled by FEASTY support. You do not need to deliver it.`
  );

  return json(200, {
    data: {
      needsAttention: manualRefund !== null,
      orderId,
      refundRecorded,
      status: ORDER_STATUS.CANCELLED,
    },
  });
};

export const adminForceCompleteOrder: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const orderId = parseOrderId(data.orderId);
  const reason = parseAdminOrderNote(data.reason, 'reason');

  const { assignment, order } = await loadOrderForAdmin(orderId);
  const observedStatus = sanitizeText(order.status);
  const previousStatus = normalizeOrderStatus(observedStatus);
  const fulfillmentType = sanitizeText(order.fulfillmentType, 'delivery');
  if (!canAdminForceCompleteOrder({ fulfillmentType, pricing: order.pricing, status: previousStatus })) {
    fail(
      412,
      fulfillmentType === 'delivery' && readOrderDeliveryProvider(order.pricing) === 'platform'
        ? 'A FEASTY rider is delivering this order. It can be completed by an admin only once the rider is on the way.'
        : 'Only accepted, preparing or ready orders can be completed.'
    );
  }
  assertOrderPaymentReadyForOperations(order);

  const deliveredAt = nowIso();
  const timeline = (order.timeline ?? {}) as JsonObject;
  const applied = await updateOrderRecordIfStatus(
    orderId,
    observedStatus,
    {
      // The same clock the partner `delivered` action starts, on the same write
      // as the status, so the customer can still confirm or report a problem.
      customerConfirmDueAt: new Date(Date.parse(deliveredAt) + CUSTOMER_CONFIRM_WINDOW_MS).toISOString(),
      status: ORDER_STATUS.DELIVERED,
      timeline: {
        ...timeline,
        ...(timeline.readyAt ? {} : { readyAt: deliveredAt }),
        deliveredAt,
      },
      updatedAt: deliveredAt,
    },
    { expectedPaymentStatus: storedPaymentStatus(order) }
  );
  if (!applied) {
    fail(409, CHANGED_MESSAGE);
  }

  await createAuditEntry(context.uid, 'order_force_completed', 'order', orderId, {
    fulfillmentType,
    previousStatus,
    reason,
  });

  await releaseRiderLoad(orderId, ORDER_STATUS.DELIVERED);

  await insertDeliveryEvent({
    actorUid: context.uid,
    details: { previousStatus },
    eventType: 'admin_force_completed',
    note: reason,
    orderId,
  });

  await notifyUsers([order.customerId], {
    ...customerOrderStatusCopy(ORDER_STATUS.DELIVERED, orderId),
    data: buildNotificationData({
      app: 'customer',
      orderId,
      routeKey: 'customer_order_detail',
      status: ORDER_STATUS.DELIVERED,
      type: 'order_update',
    }),
  });
  await notifyRestaurantUsers(order.restaurantId, {
    title: 'Order completed',
    body: `Order ${orderId.slice(-6).toUpperCase()} was marked completed by FEASTY support.`,
    data: buildNotificationData({
      app: 'partner',
      orderId,
      routeKey: 'partner_order_detail',
      status: ORDER_STATUS.DELIVERED,
      type: 'order_update',
    }),
  });
  await notifyCarryingCourier(
    assignment,
    orderId,
    ORDER_STATUS.DELIVERED,
    'Delivery completed',
    `Order ${orderId.slice(-6).toUpperCase()} was marked delivered by FEASTY support.`
  );

  return json(200, { data: { orderId, status: ORDER_STATUS.DELIVERED } });
};

export const adminResolveOrderReport: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const orderId = parseOrderId(data.orderId);
  const note = parseAdminOrderNote(data.note, 'note');

  const { order } = await loadOrderForAdmin(orderId);
  if (!order.customerIssueReportedAt) {
    fail(412, 'This order has no customer problem report to resolve.');
  }
  if (!canAdminResolveOrderReport(order)) {
    fail(412, 'This report has already been resolved.');
  }

  const resolvedAt = nowIso();
  // A customer may confirm after reporting; then only the flag is left to clear.
  // Otherwise the confirmation flow is closed exactly as the auto-close closes
  // it (source 'auto'), so the customer screen and partner app read it as done.
  const closesConfirmation = !order.customerConfirmedAt;

  let query = serviceClient
    .from('CustomerOrder')
    .update({
      ...(closesConfirmation ? { customerConfirmationSource: 'auto', customerConfirmedAt: resolvedAt } : {}),
      needsAttention: false,
      // The resolution time lives on the timeline; the admin's note goes to the
      // audit log and the timeline event, not onto a record the customer reads.
      timeline: { ...(order.timeline ?? {}), reportResolvedAt: resolvedAt },
      updatedAt: resolvedAt,
    })
    .eq('id', orderId)
    .eq('status', sanitizeText(order.status))
    .eq('needsAttention', true)
    .eq('customerIssueReportedAt', order.customerIssueReportedAt as string);
  query = closesConfirmation
    ? query.is('customerConfirmedAt', null)
    : query.eq('customerConfirmedAt', order.customerConfirmedAt as string);
  // Any write since the read (a late confirm, a timeline change) bumps
  // updatedAt; the timeline above was merged from the read, so it must win only
  // over the row it was merged from.
  if (typeof order.updatedAt === 'string') {
    query = query.eq('updatedAt', order.updatedAt);
  }
  const { data: updated, error } = await query.select('id');
  if (error) {
    throw new Error(error.message);
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    fail(409, CHANGED_MESSAGE);
  }

  await broadcastOrderChanged(orderId);

  await createAuditEntry(context.uid, 'order_report_resolved', 'order', orderId, {
    closedConfirmation: closesConfirmation,
    note,
  });

  await insertDeliveryEvent({
    actorUid: context.uid,
    details: { closedConfirmation: closesConfirmation },
    eventType: 'admin_report_resolved',
    note,
    orderId,
  });

  return json(200, {
    data: {
      customerConfirmedAt: closesConfirmation ? resolvedAt : order.customerConfirmedAt,
      needsAttention: false,
      orderId,
      reportResolvedAt: resolvedAt,
    },
  });
};
