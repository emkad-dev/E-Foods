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
//   adminResolveOrderReport - "Mark resolved": clears needsAttention on ANY
//                             flagged order (terminal ones included; no status
//                             changes) and notes the resolution. For a customer
//                             report whose confirmation flow is still open it
//                             also closes that flow the way the 3-hour
//                             auto-close does.
//
// Every write is a compare-and-set on what this request read, so a concurrent
// partner, rider, customer or sweep write wins and this request changes nothing
// (409). After an applied write the consistency side effects run first (rider
// load release, the manual-refund alert and promo release, notifications),
// then the admin trail: a DeliveryEvent carrying the admin's note and the
// AdminAuditLog entry, both best-effort (logged, never thrown) so they can
// neither skip the side effects nor turn a done action into an error.
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

/**
 * The admin trail for an applied action: the order timeline event (with the
 * admin's note) and the AdminAuditLog entry. Runs LAST and best-effort: the
 * status write has committed, so a failed trail write must neither skip a
 * consistency side effect (rider load, refund alert, promo release,
 * notifications) nor turn a done action into a 500 the admin would retry
 * against an order that has moved on. Each failure is logged on its own.
 */
const recordAdminTrail = async (input: {
  actorUid: string;
  auditAction: string;
  auditDetails: JsonObject;
  eventDetails: JsonObject;
  eventType: string;
  note: string;
  orderId: string;
}) => {
  try {
    await insertDeliveryEvent({
      actorUid: input.actorUid,
      details: input.eventDetails,
      eventType: input.eventType,
      note: input.note,
      orderId: input.orderId,
    });
  } catch (error) {
    logEdgeEvent('error', 'admin order event write failed', {
      error: error instanceof Error ? error.message : String(error),
      eventType: input.eventType,
      orderId: input.orderId,
    });
  }
  try {
    await createAuditEntry(input.actorUid, input.auditAction, 'order', input.orderId, input.auditDetails);
  } catch (error) {
    logEdgeEvent('error', 'admin order audit write failed', {
      action: input.auditAction,
      error: error instanceof Error ? error.message : String(error),
      orderId: input.orderId,
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

  await recordAdminTrail({
    actorUid: context.uid,
    auditAction: 'order_force_cancelled',
    auditDetails: { previousStatus, reason, refundRecorded, wasPaid: manualRefund !== null },
    eventDetails: { previousStatus, refundRecorded },
    eventType: 'admin_force_cancelled',
    note: reason,
    orderId,
  });

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

  await releaseRiderLoad(orderId, ORDER_STATUS.DELIVERED);

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

  await recordAdminTrail({
    actorUid: context.uid,
    auditAction: 'order_force_completed',
    auditDetails: { fulfillmentType, previousStatus, reason },
    eventDetails: { previousStatus },
    eventType: 'admin_force_completed',
    note: reason,
    orderId,
  });

  return json(200, { data: { orderId, status: ORDER_STATUS.DELIVERED } });
};

export const adminResolveOrderReport: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const orderId = parseOrderId(data.orderId);
  const note = parseAdminOrderNote(data.note, 'note');

  const { order } = await loadOrderForAdmin(orderId);
  // Any flag, not only a customer report: a late payment on a closed order, a
  // refund to return by hand, a stale escalation. Each can outlive the order's
  // last status change and had no other way to be cleared.
  if (!canAdminResolveOrderReport(order)) {
    fail(412, 'This order is not flagged for attention.');
  }

  const resolvedAt = nowIso();
  const reportedAt = order.customerIssueReportedAt ?? null;
  // The confirmation flow is closed only for a customer report whose flow is
  // still open (delivered, a deadline set, not yet confirmed), exactly as the
  // auto-close closes it (source 'auto'), so the customer screen and partner
  // app read it as done. A customer who confirmed after reporting, or any
  // other flag, leaves the confirmation fields alone. No status changes.
  const closesConfirmation = Boolean(
    reportedAt &&
      normalizeOrderStatus(order.status) === ORDER_STATUS.DELIVERED &&
      order.customerConfirmDueAt &&
      !order.customerConfirmedAt
  );

  let query = serviceClient
    .from('CustomerOrder')
    .update({
      ...(closesConfirmation ? { customerConfirmationSource: 'auto', customerConfirmedAt: resolvedAt } : {}),
      needsAttention: false,
      // The resolution time lives on the timeline; the admin's note goes to the
      // audit log and the timeline event, not onto a record the customer reads.
      timeline: {
        ...(order.timeline ?? {}),
        attentionResolvedAt: resolvedAt,
        ...(reportedAt ? { reportResolvedAt: resolvedAt } : {}),
      },
      updatedAt: resolvedAt,
    })
    .eq('id', orderId)
    .eq('status', sanitizeText(order.status))
    .eq('needsAttention', true);
  query = reportedAt ? query.eq('customerIssueReportedAt', reportedAt) : query.is('customerIssueReportedAt', null);
  query = order.customerConfirmedAt
    ? query.eq('customerConfirmedAt', order.customerConfirmedAt)
    : query.is('customerConfirmedAt', null);
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

  await recordAdminTrail({
    actorUid: context.uid,
    auditAction: reportedAt ? 'order_report_resolved' : 'order_attention_resolved',
    auditDetails: { closedConfirmation: closesConfirmation, note, status: normalizeOrderStatus(order.status) },
    eventDetails: { closedConfirmation: closesConfirmation },
    eventType: reportedAt ? 'admin_report_resolved' : 'admin_attention_resolved',
    note,
    orderId,
  });

  return json(200, {
    data: {
      attentionResolvedAt: resolvedAt,
      customerConfirmedAt: closesConfirmation ? resolvedAt : (order.customerConfirmedAt ?? null),
      needsAttention: false,
      orderId,
    },
  });
};
