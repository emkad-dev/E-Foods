// Order records: the row shapes, the status vocabulary, the loaders every
// domain reads through, and the mutations that keep an order and its delivery
// events in step.
//
// Everything in here is shared by at least two domains. Customer-only order
// creation (draft preparation, pricing, Paystack) lives in domains/orders.ts.

import { serviceClient } from './client.ts';
import {
  buildNotificationData,
  notifyRestaurantUsers,
  notifyUsers,
} from './notifications.ts';
import { broadcastOrderChanged } from './realtime.ts';
import type { JsonObject } from './rpc/coercion.ts';
import { nowIso, sanitizeOptionalText, sanitizeText, toSortableTimestamp } from './rpc/coercion.ts';
import { fail } from './rpc/respond.ts';

export type CustomerOrderRow = {
  cancellation?: JsonObject | null;
  createdAt?: string | null;
  customerId: string;
  deliveryAddress?: string | null;
  deliveryLocation?: JsonObject | null;
  fulfillmentType?: string | null;
  id: string;
  payment?: JsonObject | null;
  pricing?: JsonObject | null;
  restaurantId: string;
  restaurantName: string;
  status?: string | null;
  timeline?: JsonObject | null;
  updatedAt?: string | null;
};

export type DeliveryAssignmentRow = {
  assignedAt?: string | null;
  courierId?: string | null;
  courierName?: string | null;
  dispatchId?: string | null;
  dispatchOwnerId?: string | null;
  orderId: string;
};

export type DeliveryEventRow = {
  actorUid?: string | null;
  createdAt?: string | null;
  details?: JsonObject | null;
  eventType: string;
  id: string;
  note?: string | null;
  orderId: string;
};

export type OrderItemRow = {
  itemId: string;
  name: string;
  orderId: string;
  price: number;
  quantity: number;
  restaurantId: string;
  restaurantName: string;
};

export type PaymentTransactionRow = {
  accessCode?: string | null;
  authorizationUrl?: string | null;
  channel?: string | null;
  customerId: string;
  gatewayStatus?: string | null;
  lastError?: string | null;
  method: string;
  orderId: string;
  reference: string;
  restaurantId: string;
  splitSubaccountCode?: string | null;
  status: string;
};

export type OrderSnapshotOptions = {
  courierPhone?: string | null;
  courierLatitude?: number | null;
  courierLongitude?: number | null;
  courierUpdatedAt?: string | null;
  customerPhone?: string | null;
};

export const CUSTOMER_ORDER_COLUMNS =
  'id,customerId,restaurantId,restaurantName,status,fulfillmentType,pricing,payment,deliveryAddress,deliveryLocation,cancellation,timeline,createdAt,updatedAt';

export const ORDER_STATUS = {
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
  DELIVERED: 'delivered',
  ESCALATED: 'escalated',
  FAILED_DELIVERY: 'failed_delivery',
  ON_THE_WAY: 'on_the_way',
  PICKED_UP: 'picked_up',
  PLACED: 'placed',
  PREPARING: 'preparing',
  READY_FOR_PICKUP: 'ready_for_pickup',
  REJECTED: 'rejected',
} as const;

export const TERMINAL_ORDER_STATUSES = new Set(['delivered', 'cancelled', 'rejected', 'failed_delivery']);

export const FAILED_ORDER_STATUSES = new Set<string>([
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REJECTED,
  ORDER_STATUS.FAILED_DELIVERY,
]);

export const PREPAID_PAYMENT_METHODS = new Set(['card', 'wallet', 'bank_transfer']);
export const PAYSTACK_PAYMENT_METHODS = new Set(['card', 'bank_transfer']);

export const PAYMENT_STATUS = {
  AUTHORIZED: 'authorized',
  FAILED: 'failed',
  PAID: 'paid',
  PENDING: 'pending',
  REFUNDED: 'refunded',
} as const;

export const PAYMENT_PROVIDER_PAYSTACK = 'paystack';
export const PAYMENT_PROVIDER_CASH = 'cash_on_delivery';

export const DEFAULT_FUNCTION_ORDER_STATUS = 'placed';
export const DEFAULT_CURRENCY = 'NGN';

/** A prepaid checkout that never gets paid is cancelled after this window. */
export const ORDER_PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

export const normalizeOrderStatus = (value: unknown) => {
  const status = sanitizeText(value, 'draft');
  switch (status) {
    case 'pending':
    // 'confirmed' was written by the async order/payment handlers but is not a valid
    // order status; treat it as 'placed' so paid orders stay actionable.
    case 'confirmed':
      return ORDER_STATUS.PLACED;
    case 'ready':
      return ORDER_STATUS.READY_FOR_PICKUP;
    default:
      return status;
  }
};

export const toOrderSnapshotResponse = (
  order: CustomerOrderRow,
  items: OrderItemRow[],
  assignment: DeliveryAssignmentRow | null,
  events: DeliveryEventRow[] = [],
  options: OrderSnapshotOptions = {}
) => ({
  assignment: assignment
    ? {
        courierId: sanitizeOptionalText(assignment.courierId),
        courierName: sanitizeOptionalText(assignment.courierName),
        courierLatitude: options.courierLatitude ?? null,
        courierLongitude: options.courierLongitude ?? null,
        courierPhone: sanitizeOptionalText(options.courierPhone),
        courierUpdatedAt: options.courierUpdatedAt ?? null,
        dispatchId: sanitizeOptionalText(assignment.dispatchId),
        dispatchOwnerId: sanitizeOptionalText(assignment.dispatchOwnerId),
      }
    : null,
  cancellation: order.cancellation ?? null,
  createdAt: order.createdAt ?? null,
  customerId: order.customerId,
  customerPhone: sanitizeOptionalText(options.customerPhone),
  deliveryAddress: sanitizeOptionalText(order.deliveryAddress),
  deliveryLocation: order.deliveryLocation ?? null,
  events: events.map((event) => ({
    actorUid: sanitizeOptionalText(event.actorUid),
    createdAt: event.createdAt ?? null,
    details: event.details ?? null,
    eventType: event.eventType,
    id: event.id,
    note: sanitizeOptionalText(event.note),
  })),
  fulfillmentType: sanitizeText(order.fulfillmentType, 'delivery'),
  id: order.id,
  items: items.map((item) => ({
    id: item.itemId,
    name: item.name,
    price: Number(item.price ?? 0),
    quantity: Number(item.quantity ?? 0),
    restaurantId: item.restaurantId,
    restaurantName: item.restaurantName,
  })),
  payment: order.payment ?? null,
  pricing: order.pricing ?? null,
  restaurantId: order.restaurantId,
  restaurantName: order.restaurantName,
  status: normalizeOrderStatus(sanitizeText(order.status, DEFAULT_FUNCTION_ORDER_STATUS)),
  timeline: order.timeline ?? null,
  total: Number((order.pricing as JsonObject | null)?.total ?? 0),
  updatedAt: order.updatedAt ?? null,
});

export type DispatchOrderDetailResponse = ReturnType<typeof toOrderSnapshotResponse>;

export const upsertPaymentTransaction = async (payload: JsonObject & { reference: string }) => {
  const { data: existingTransaction, error: lookupError } = await serviceClient
    .from('PaymentTransaction')
    .select('id')
    .eq('reference', payload.reference)
    .maybeSingle<{ id: string }>();

  if (lookupError) {
    throw new Error(`Failed to resolve payment transaction id: ${lookupError.message}`);
  }

  const { error } = await serviceClient.from('PaymentTransaction').upsert(
    {
      id: existingTransaction?.id?.trim() || payload.reference.trim(),
      ...payload,
      updatedAt: new Date().toISOString(),
    },
    {
    onConflict: 'reference',
    }
  );

  if (error) {
    throw new Error(error.message);
  }
};

export const insertDeliveryEvent = async (payload: JsonObject) => {
  const eventPayload = {
    id: crypto.randomUUID(),
    ...payload,
  };
  const { error } = await serviceClient.from('DeliveryEvent').insert(eventPayload);

  if (error) {
    throw new Error(error.message);
  }
};

export const updateOrderRecord = async (orderId: string, updates: JsonObject) => {
  const { error } = await serviceClient.from('CustomerOrder').update(updates).eq('id', orderId);

  if (error) {
    throw new Error(error.message);
  }

  await broadcastOrderChanged(orderId);
};

export const loadOrderRelations = async (orderIds: string[]) => {
  if (orderIds.length === 0) {
    return {
      assignmentsByOrderId: new Map<string, DeliveryAssignmentRow>(),
      eventsByOrderId: new Map<string, DeliveryEventRow[]>(),
      itemsByOrderId: new Map<string, OrderItemRow[]>(),
    };
  }

  const [{ data: items, error: itemsError }, { data: assignments, error: assignmentError }, { data: events, error: eventsError }] =
    await Promise.all([
      serviceClient
        .from('OrderItem')
        .select('orderId,itemId,name,price,quantity,restaurantId,restaurantName')
        .in('orderId', orderIds),
      serviceClient
        .from('DeliveryAssignment')
        .select('orderId,dispatchId,dispatchOwnerId,courierId,courierName,assignedAt')
        .in('orderId', orderIds),
      serviceClient
        .from('DeliveryEvent')
        .select('id,orderId,eventType,actorUid,note,details,createdAt')
        .in('orderId', orderIds)
        .order('createdAt', { ascending: true }),
    ]);

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  if (eventsError) {
    throw new Error(eventsError.message);
  }

  const itemsByOrderId = new Map<string, OrderItemRow[]>();
  for (const item of (items ?? []) as OrderItemRow[]) {
    const bucket = itemsByOrderId.get(item.orderId) ?? [];
    bucket.push(item);
    itemsByOrderId.set(item.orderId, bucket);
  }

  const assignmentsByOrderId = new Map(
    ((assignments ?? []) as DeliveryAssignmentRow[]).map((assignment) => [assignment.orderId, assignment] as const)
  );

  const eventsByOrderId = new Map<string, DeliveryEventRow[]>();
  for (const event of (events ?? []) as DeliveryEventRow[]) {
    const bucket = eventsByOrderId.get(event.orderId) ?? [];
    bucket.push(event);
    eventsByOrderId.set(event.orderId, bucket);
  }

  return {
    assignmentsByOrderId,
    eventsByOrderId,
    itemsByOrderId,
  };
};

export const loadOrderBundle = async (orderId: string, includeEvents = false) => {
  const { data: order, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq('id', orderId)
    .maybeSingle<CustomerOrderRow>();

  if (error) {
    throw new Error(error.message);
  }

  if (!order) {
    return null;
  }

  const normalizedOrder = await maybeExpireUnpaidOrder(order);
  const { assignmentsByOrderId, eventsByOrderId, itemsByOrderId } = await loadOrderRelations([orderId]);
  return {
    assignment: assignmentsByOrderId.get(orderId) ?? null,
    events: includeEvents ? eventsByOrderId.get(orderId) ?? [] : [],
    items: itemsByOrderId.get(orderId) ?? [],
    order: normalizedOrder,
  };
};

export const isOrderOperationallyVisible = (order: CustomerOrderRow) => {
  const paymentMethod = sanitizeText(order.payment?.method, 'cash');
  const paymentStatus = sanitizeText(order.payment?.status, PAYMENT_STATUS.PENDING);
  const currentStatus = normalizeOrderStatus(order.status);

  if (!PREPAID_PAYMENT_METHODS.has(paymentMethod)) {
    return true;
  }

  if (paymentStatus === PAYMENT_STATUS.PAID) {
    return true;
  }

  return TERMINAL_ORDER_STATUSES.has(currentStatus);
};

// Admin and partner order lists/counts stay clean: unpaid prepaid checkouts and
// failed outcomes (cancelled/rejected/failed delivery) are excluded. Customers
// always see their full order history via the customer read paths.
export const isOrderCleanForReporting = (order: CustomerOrderRow) => {
  const paymentMethod = sanitizeText(order.payment?.method, 'cash');
  const paymentStatus = sanitizeText(order.payment?.status, PAYMENT_STATUS.PENDING);
  const currentStatus = normalizeOrderStatus(order.status);

  if (FAILED_ORDER_STATUSES.has(currentStatus)) {
    return false;
  }

  if (PREPAID_PAYMENT_METHODS.has(paymentMethod) && paymentStatus !== PAYMENT_STATUS.PAID) {
    return false;
  }

  return true;
};

export const assertOrderPaymentReadyForOperations = (order: CustomerOrderRow) => {
  if (!isOrderOperationallyVisible(order)) {
    fail(412, 'This order is still waiting for online payment confirmation and cannot move into kitchen or dispatch yet.');
  }
};

export const assertNonTerminalOrder = (order: CustomerOrderRow) => {
  if (TERMINAL_ORDER_STATUSES.has(normalizeOrderStatus(order.status))) {
    fail(412, 'This order can no longer be updated.');
  }
};

/**
 * Lazy expiry for prepaid orders that were never paid. Runs on read rather than
 * on a schedule, so any path that surfaces an order also settles its fate; the
 * returned row is the post-expiry one so callers never render a stale status.
 */
export const maybeExpireUnpaidOrder = async (order: CustomerOrderRow) => {
  const currentStatus = normalizeOrderStatus(order.status);
  if (TERMINAL_ORDER_STATUSES.has(currentStatus)) {
    return order;
  }

  const paymentMethod = sanitizeText(order.payment?.method);
  const paymentStatus = sanitizeText(order.payment?.status, PAYMENT_STATUS.PENDING);
  if (!PAYSTACK_PAYMENT_METHODS.has(paymentMethod) || paymentStatus !== PAYMENT_STATUS.PENDING) {
    return order;
  }

  const createdAt = toSortableTimestamp(order.createdAt);
  if (!createdAt || Date.now() - createdAt < ORDER_PAYMENT_TIMEOUT_MS) {
    return order;
  }

  const timedOutAt = nowIso();
  const payment = {
    ...(order.payment ?? {}),
    lastEvent: 'payment_timeout',
    failedAt: timedOutAt,
    status: PAYMENT_STATUS.FAILED,
    verifiedAt: timedOutAt,
  };
  const cancellation = {
    actor: 'system',
    reason: 'payment_timeout',
    timedOutAt,
  };
  const timeline = {
    ...(order.timeline ?? {}),
    cancelledAt: timedOutAt,
    paymentTimedOutAt: timedOutAt,
  };

  await updateOrderRecord(order.id, {
    cancellation,
    payment,
    status: ORDER_STATUS.CANCELLED,
    timeline,
    updatedAt: timedOutAt,
  });

  await insertDeliveryEvent({
    actorUid: null,
    details: {
      timeoutMinutes: ORDER_PAYMENT_TIMEOUT_MS / 60000,
    },
    eventType: 'payment_timeout',
    orderId: order.id,
  });

  await notifyUsers([order.customerId], {
    title: 'Order timed out',
    body: `Order ${order.id.slice(-6).toUpperCase()} was cancelled because payment was not completed in time.`,
    data: buildNotificationData({
      app: 'customer',
      orderId: order.id,
      routeKey: 'customer_order_detail',
      type: 'order_update',
    }),
  });
  await notifyRestaurantUsers(order.restaurantId, {
    title: 'Unpaid order cancelled',
    body: `Order ${order.id.slice(-6).toUpperCase()} expired after the payment window closed.`,
    data: buildNotificationData({
      app: 'partner',
      orderId: order.id,
      routeKey: 'partner_order_detail',
      type: 'order_update',
    }),
  });

  return {
    ...order,
    cancellation,
    payment,
    status: ORDER_STATUS.CANCELLED,
    timeline,
    updatedAt: timedOutAt,
  };
};

export const hasAssignedCourier = (assignment: DeliveryAssignmentRow | null) =>
  Boolean(sanitizeText(assignment?.courierId));

export const getDispatchAssignmentOwnerId = (assignment: DeliveryAssignmentRow | null) =>
  sanitizeText(assignment?.dispatchOwnerId) ?? sanitizeText(assignment?.dispatchId);
