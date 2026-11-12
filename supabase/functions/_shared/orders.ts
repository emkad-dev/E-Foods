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
import { logEdgeEvent } from './observability.ts';
import { broadcastOrderChanged } from './realtime.ts';
import type { JsonObject } from './rpc/coercion.ts';
import { nowIso, sanitizeOptionalText, sanitizeText, toSortableTimestamp } from './rpc/coercion.ts';
import { fail } from './rpc/respond.ts';

export type CustomerOrderRow = {
  cancellation?: JsonObject | null;
  createdAt?: string | null;
  customerId: string;
  // Customer order confirmation. DueAt is set only by the partner `delivered`
  // action (completion + 3h); null means the order is not in the flow.
  // Confirmation never changes `status` - it stays 'delivered'.
  customerConfirmDueAt?: string | null;
  customerConfirmedAt?: string | null;
  customerConfirmationSource?: string | null;
  // Server-only: how many reminder stages the sweep has consumed.
  customerConfirmRemindersSent?: number | null;
  customerIssueReportedAt?: string | null;
  deliveryAddress?: string | null;
  deliveryLocation?: JsonObject | null;
  // SP-2 proof-of-delivery OTP. The code is customer-only: it is read by
  // customerGetOrderDetail and deliberately never copied by
  // toOrderSnapshotResponse (the rider/partner/admin shape).
  deliveryCode?: string | null;
  deliveryCodeAttempts?: number | null;
  deliveryCodeVerifiedAt?: string | null;
  fulfillmentType?: string | null;
  id: string;
  needsAttention?: boolean | null;
  payment?: JsonObject | null;
  pricing?: JsonObject | null;
  orderGroupId?: string | null;
  restaurantId: string;
  restaurantName: string;
  // Task 18 (G2): the customer-requested slot as a UTC instant, or null for an
  // immediate order. Present only on scheduled orders.
  scheduledFor?: string | null;
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
  optionDelta?: number | null;
  price: number;
  quantity: number;
  restaurantId: string;
  restaurantName: string;
  selectedOptions?: JsonObject[] | null;
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
  orderGroupId?: string | null;
  reference: string;
  restaurantId: string;
  splitSubaccountCode?: string | null;
  settlementMode?: string | null;
  status: string;
};

export type OrderGroupRow = {
  customerId: string;
  id: string;
  orderCount?: number | null;
  orderIds?: JsonObject | null;
  payment?: JsonObject | null;
  pricing?: JsonObject | null;
  primaryOrderId: string;
  restaurantCount?: number | null;
  restaurantIds?: JsonObject | null;
};

export type OrderSnapshotOptions = {
  courierPhone?: string | null;
  courierLatitude?: number | null;
  courierLongitude?: number | null;
  courierUpdatedAt?: string | null;
  customerPhone?: string | null;
  // Live-tracking extras, populated only by customerGetOrderDetail. The map
  // pins the restaurant origin; `eta` is the server's prep-aware initial
  // delivery estimate for first paint and `averageSpeedKmh` lets the client
  // recompute the live rider ETA from each rider-position broadcast without
  // a round trip.
  restaurantLatitude?: number | null;
  restaurantLongitude?: number | null;
  eta?: { minMinutes: number; maxMinutes: number } | null;
  averageSpeedKmh?: number | null;
  orderGroup?: OrderGroupRow | null;
};

export const CUSTOMER_ORDER_COLUMNS =
  'id,customerId,restaurantId,restaurantName,status,fulfillmentType,pricing,payment,deliveryAddress,deliveryLocation,cancellation,timeline,needsAttention,scheduledFor,orderGroupId,deliveryCode,deliveryCodeVerifiedAt,deliveryCodeAttempts,customerConfirmDueAt,customerConfirmedAt,customerConfirmationSource,customerConfirmRemindersSent,customerIssueReportedAt,createdAt,updatedAt';

export const ORDER_GROUP_COLUMNS =
  'id,customerId,primaryOrderId,orderIds,orderCount,pricing,payment,restaurantIds,restaurantCount';

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
  // Task 18 (G2): a paid-and-waiting scheduled order. Pre-kitchen — the
  // release sweep flips it to PLACED at `scheduledFor − prepTimeMinutes`. It is
  // deliberately excluded from TERMINAL_ORDER_STATUSES (below) and from the
  // acceptance-deadline sweep's placed-like candidate set, so it is never
  // auto-cancelled while it waits.
  SCHEDULED: 'scheduled',
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

/** A card checkout is finished within minutes or abandoned: unpaid after this
 * window, the order is cancelled. */
export const CARD_PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;
/** Bank transfers land late - production saw them confirmed at 9.5 and 31.5
 * minutes - so cancelling at 15 minutes turned real payments into late payments
 * on dead orders. */
export const BANK_TRANSFER_PAYMENT_TIMEOUT_MS = 35 * 60 * 1000;

/** The unpaid window for a payment method. Card and any other or unknown method
 * get the card window; only a bank transfer gets the longer one. */
export const paymentTimeoutMsForMethod = (method: unknown) =>
  sanitizeText(method) === 'bank_transfer' ? BANK_TRANSFER_PAYMENT_TIMEOUT_MS : CARD_PAYMENT_TIMEOUT_MS;

/** Stored order statuses an unpaid prepaid order sits in: it is inserted
 * 'placed' (or 'scheduled') BEFORE payment; 'pending'/'confirmed'/'draft' are
 * legacy spellings of the same thing. Anything past these is in the kitchen or
 * closed and is never expired. */
export const UNPAID_EXPIRY_ORDER_STATUSES = ['placed', 'pending', 'confirmed', 'draft', 'scheduled'];

/** An expiry this long past its deadline is closed silently. The first sweep
 * after deploy finds orders stuck since June; telling a customer "Order timed
 * out" months later is noise, and the restaurant has long forgotten them. */
export const SILENT_EXPIRY_AFTER_DEADLINE_MS = 24 * 60 * 60 * 1000;

/** Payment states that mean no money was captured: the order may be expired. */
export const UNCAPTURED_PAYMENT_STATUSES: string[] = [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED];

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
  // The reminder counter is deliberately not exposed: clients only need to know
  // whether the order awaits confirmation and how it ended.
  customerConfirmDueAt: order.customerConfirmDueAt ?? null,
  customerConfirmedAt: order.customerConfirmedAt ?? null,
  customerConfirmationSource: order.customerConfirmationSource ?? null,
  customerIssueReportedAt: order.customerIssueReportedAt ?? null,
  customerId: order.customerId,
  customerPhone: sanitizeOptionalText(options.customerPhone),
  deliveryAddress: sanitizeOptionalText(order.deliveryAddress),
  deliveryLocation: order.deliveryLocation ?? null,
  orderGroupId: order.orderGroupId ?? null,
  orderGroup: options.orderGroup ?? null,
  restaurantLatitude: options.restaurantLatitude ?? null,
  restaurantLongitude: options.restaurantLongitude ?? null,
  eta: options.eta ?? null,
  averageSpeedKmh: options.averageSpeedKmh ?? null,
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
  needsAttention: order.needsAttention === true,
  items: items.map((item) => ({
    id: item.itemId,
    name: item.name,
    price: Number(item.price ?? 0),
    quantity: Number(item.quantity ?? 0),
    optionDelta: item.optionDelta ?? 0,
    restaurantId: item.restaurantId,
    restaurantName: item.restaurantName,
    selectedOptions: (item.selectedOptions as JsonObject[] | null | undefined) ?? [],
  })),
  payment: order.payment ?? null,
  pricing: order.pricing ?? null,
  restaurantId: order.restaurantId,
  restaurantName: order.restaurantName,
  // Task 18 (G2): the scheduled slot, surfaced to customer tracking and the
  // partner kitchen board. Null for immediate orders.
  scheduledFor: order.scheduledFor ?? null,
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

/**
 * True when a status write means the order no longer needs a human: the
 * restaurant accepted it, or it reached a terminal status. needsAttention is
 * then stale (raised by the acceptance escalation or a late payment) and must
 * be dropped - an admin queue full of delivered orders hides the real ones.
 */
export const statusWriteClearsAttention = (updates: JsonObject): boolean => {
  if (typeof updates.status !== 'string') {
    return false;
  }
  // The same write raising the flag (a paid rejection, an admin force-cancel)
  // is deliberately alerting a human: never undo it.
  if (updates.needsAttention === true) {
    return false;
  }
  const next = normalizeOrderStatus(updates.status);
  return next === ORDER_STATUS.ACCEPTED || TERMINAL_ORDER_STATUSES.has(next);
};

// Every accept / terminal write funnels through updateOrderRecord or
// updateOrderRecordIfStatus, so partner, dispatch, customer cancel and the
// sweeps all get the clear from this one place. It is a second, filtered UPDATE
// (not needsAttention:false in the main write) because a customer problem report
// (customerIssueReportedAt) must keep the flag, and PostgREST cannot make one
// column of an update conditional on another.
//
// Two guards keep it from hiding a NEWER alert: the status guard (the order has
// not moved on) and an updatedAt guard - the status write stamps updatedAt, and
// the clear applies only if nobody has written since (a late-payment flag set
// between the two statements bumps updatedAt and so survives).
const withStampedUpdatedAt = (updates: JsonObject): JsonObject =>
  statusWriteClearsAttention(updates) && typeof updates.updatedAt !== 'string'
    ? { ...updates, updatedAt: new Date().toISOString() }
    : updates;

// BEST-EFFORT: the status write already committed, so a failure here must not
// fail the caller's action (the partner would see "failed" over a done accept)
// or skip its broadcast and notifications. Logged, never thrown.
const clearAttentionAfterStatusWrite = async (orderId: string, updates: JsonObject) => {
  if (!statusWriteClearsAttention(updates) || typeof updates.updatedAt !== 'string') {
    return;
  }
  try {
    const { error } = await serviceClient
      .from('CustomerOrder')
      .update({ needsAttention: false })
      .eq('id', orderId)
      .eq('status', updates.status as string)
      .eq('updatedAt', updates.updatedAt)
      .eq('needsAttention', true)
      .is('customerIssueReportedAt', null);

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    logEdgeEvent('error', 'needsAttention clear after status write failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
  }
};

export const updateOrderRecord = async (orderId: string, rawUpdates: JsonObject) => {
  const updates = withStampedUpdatedAt(rawUpdates);
  const { error } = await serviceClient.from('CustomerOrder').update(updates).eq('id', orderId);

  if (error) {
    throw new Error(error.message);
  }

  await clearAttentionAfterStatusWrite(orderId, updates);
  await broadcastOrderChanged(orderId);
};

// Task 17 (G1): free the promo-cap slot an order held once it ends
// cancelled/refunded. THE single shared release path — the customer placement
// handlers (on synchronous placement/init failure), the post-placement
// terminal-cancel transitions (customer self-cancel, unpaid-payment timeout,
// acceptance-deadline auto-cancel) and a paid order's rejection or failed
// delivery (_shared/manualRefund.ts) all funnel through here, so a redemption
// tied to an order that does not end successful is always released.
//
// Safe by construction:
//   * IDEMPOTENT & no-op on the no-promo case — ebuy_release_promo_redemption
//     deletes by the UNIQUE orderId, so an order that never redeemed deletes
//     zero rows, and a second release deletes zero rows. No negative count, no
//     double-free.
//   * MONEY-DIRECTION SAFE — releasing removes the PromoRedemption row, which
//     is exactly what ebuy_redeem_promo_code counts, so the effective cap count
//     drops by one and the freed slot is genuinely reusable by the customer.
//   * BEST-EFFORT — never throws; a release failure is logged, never allowed to
//     abort or roll back the surrounding cancel/refund (same discipline as the
//     notification calls around it).
export const releasePromoRedemption = async (orderId: string): Promise<void> => {
  try {
    const { error } = await serviceClient.rpc('ebuy_release_promo_redemption', { p_order_id: orderId });
    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    logEdgeEvent('error', 'promo redemption release failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
  }
};

/**
 * Compare-and-swap variant of updateOrderRecord: applies `updates` only if the
 * order's stored status still equals `expectedStatus`, and reports whether it
 * did. This is the write-time guard for handlers that validate a transition
 * against a status they read earlier in the same request (a stale snapshot) and
 * would otherwise write unconditionally — the classic read-then-write race.
 *
 * `expectedStatus` is the RAW stored value the caller observed (not the
 * normalized one): PostgREST turns `.eq('id').eq('status', expected)` into
 * `UPDATE ... WHERE id = ? AND status = ?`, which Postgres re-evaluates against
 * the latest committed row version when it takes the row lock (EvalPlanQual
 * under READ COMMITTED). So if a concurrent writer committed a different status
 * (e.g. the acceptance sweep cancelling + refunding a `placed` order) between
 * the caller's read and this write, the qual no longer matches, zero rows
 * update, and the caller learns its snapshot was stale instead of silently
 * clobbering the committed state. `.select('id')` is what surfaces the affected
 * count. The broadcast fires only when the row actually changed.
 */
export const updateOrderRecordIfStatus = async (
  orderId: string,
  expectedStatus: string,
  rawUpdates: JsonObject,
  options: {
    /** Also require the stored payment.status to still be this RAW value (null =
     * absent). Used where a payment confirmation racing the write must win, e.g.
     * the unpaid expiry must not cancel an order the webhook just marked paid. */
    expectedPaymentStatus?: string | null;
  } = {}
): Promise<boolean> => {
  const updates = withStampedUpdatedAt(rawUpdates);
  let query = serviceClient
    .from('CustomerOrder')
    .update(updates)
    .eq('id', orderId)
    .eq('status', expectedStatus);
  if (options.expectedPaymentStatus !== undefined) {
    query =
      options.expectedPaymentStatus === null
        ? query.is('payment->>status', null)
        : query.eq('payment->>status', options.expectedPaymentStatus);
  }
  const { data, error } = await query.select('id');

  if (error) {
    throw new Error(error.message);
  }

  const applied = Array.isArray(data) && data.length > 0;
  if (applied) {
    await clearAttentionAfterStatusWrite(orderId, updates);
    await broadcastOrderChanged(orderId);
  }
  return applied;
};

// Compare-and-swap for the customer-confirmation writes. The status guard is
// not enough on its own: confirming and reporting race each other, the 3-hour
// auto-close and a double tap, so each write also names the columns that must
// still be null (e.g. `customerConfirmedAt`) for it to apply. Returns whether a
// row matched; broadcasts only when it did.
export const updateDeliveredOrderIfNull = async (
  orderId: string,
  nullColumns: string[],
  updates: JsonObject
): Promise<boolean> => {
  let query = serviceClient
    .from('CustomerOrder')
    .update(updates)
    .eq('id', orderId)
    .eq('status', ORDER_STATUS.DELIVERED);
  for (const column of nullColumns) {
    query = query.is(column, null);
  }
  const { data, error } = await query.select('id');

  if (error) {
    throw new Error(error.message);
  }

  const applied = Array.isArray(data) && data.length > 0;
  if (applied) {
    await broadcastOrderChanged(orderId);
  }
  return applied;
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

export const loadOrderBundle = async (
  orderId: string,
  includeEvents = false,
  options: {
    /** False skips the lazy unpaid expiry. The payment refresh passes false: it
     * is about to ask Paystack, and expiring first would cancel an order whose
     * payment that very answer may confirm. */
    expireUnpaid?: boolean;
  } = {}
) => {
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

  const normalizedOrder = options.expireUnpaid === false ? order : await maybeExpireUnpaidOrder(order);
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

/** The raw stored payment.status, or null when absent - the value a
 * compare-and-set on the payment must name (normalizing would let the CAS match
 * a row it did not read). */
export const storedPaymentStatus = (order: Pick<CustomerOrderRow, 'payment'>): string | null => {
  const status = (order.payment ?? {}).status;
  return typeof status === 'string' ? status : null;
};

/**
 * Pure: whether an order is an uncaptured prepaid checkout whose payment window
 * has run out. A FAILED payment waits out the same window as a pending one,
 * because Paystack reports a checkout the customer is still on as 'abandoned'
 * (stored as failed) and a failed attempt can still be retried on the same
 * reference until then.
 */
export const isUnpaidOrderExpired = (order: CustomerOrderRow, nowMs: number) => {
  if (!UNPAID_EXPIRY_ORDER_STATUSES.includes(sanitizeText(order.status))) {
    return false;
  }

  const paymentMethod = sanitizeText(order.payment?.method);
  const paymentStatus = sanitizeText(order.payment?.status, PAYMENT_STATUS.PENDING);
  if (!PAYSTACK_PAYMENT_METHODS.has(paymentMethod) || !UNCAPTURED_PAYMENT_STATUSES.includes(paymentStatus)) {
    return false;
  }

  const createdAt = toSortableTimestamp(order.createdAt);
  return Boolean(createdAt) && nowMs - createdAt >= paymentTimeoutMsForMethod(paymentMethod);
};

// The ledger row must agree with the order, or 47 transactions sit 'pending' on
// orders the timeout cancelled long ago. Guarded on the ledger's own status so a
// payment confirmation recorded in between is never overwritten. Best-effort:
// the order is already cancelled, and the promo release, event and notifications
// after this must still happen exactly once.
const markPaymentTransactionExpired = async (order: CustomerOrderRow, failedAt: string, reason: string) => {
  const reference = sanitizeText(order.payment?.reference);
  if (!reference) {
    return;
  }
  try {
    const { error } = await serviceClient
      .from('PaymentTransaction')
      .update({ failedAt, lastError: reason, status: PAYMENT_STATUS.FAILED, updatedAt: failedAt })
      .eq('reference', reference)
      .in('status', UNCAPTURED_PAYMENT_STATUSES);
    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    logEdgeEvent('error', 'payment transaction not marked failed on unpaid expiry', {
      error: error instanceof Error ? error.message : String(error),
      orderId: order.id,
    });
  }
};

/**
 * Cancels an uncaptured prepaid order whose payment window has run out. THE one
 * expiry path: the scheduled sweep (unpaidOrderExpirySweep.ts) and the lazy
 * check on read (maybeExpireUnpaidOrder) both come here.
 *
 * The write is a compare-and-set on BOTH the stored order status and the stored
 * payment status this caller read, so a webhook or customer refresh that marks
 * the order paid between the read and the write wins: zero rows match and
 * nothing else here runs. A payment that lands AFTER the cancel is caught by the
 * verification's closed-order safeguard (needsAttention + latePaymentAt).
 * Nothing was captured, so no refund is recorded.
 */
export const expireUnpaidOrder = async (
  order: CustomerOrderRow,
  nowMs: number = Date.now()
): Promise<{ expired: boolean; order: CustomerOrderRow }> => {
  if (!isUnpaidOrderExpired(order, nowMs)) {
    return { expired: false, order };
  }

  const timedOutAt = nowIso();
  const paymentFailed = sanitizeText(order.payment?.status) === PAYMENT_STATUS.FAILED;
  const reason = paymentFailed ? 'payment_failed' : 'payment_timeout';
  const timeoutMs = paymentTimeoutMsForMethod(order.payment?.method);
  const timeoutMinutes = timeoutMs / 60000;
  const silent = nowMs - (toSortableTimestamp(order.createdAt) + timeoutMs) > SILENT_EXPIRY_AFTER_DEADLINE_MS;
  const payment = {
    ...(order.payment ?? {}),
    lastEvent: 'payment_timeout',
    // A failed payment keeps the time it actually failed.
    failedAt: sanitizeOptionalText(order.payment?.failedAt) ?? timedOutAt,
    status: PAYMENT_STATUS.FAILED,
    verifiedAt: timedOutAt,
  };
  const cancellation = {
    actor: 'system',
    reason,
    timedOutAt,
  };
  const timeline = {
    ...(order.timeline ?? {}),
    cancelledAt: timedOutAt,
    paymentTimedOutAt: timedOutAt,
  };

  const applied = await updateOrderRecordIfStatus(
    order.id,
    order.status as string,
    {
      cancellation,
      payment,
      status: ORDER_STATUS.CANCELLED,
      timeline,
      updatedAt: timedOutAt,
    },
    { expectedPaymentStatus: storedPaymentStatus(order) }
  );
  if (!applied) {
    return { expired: false, order };
  }

  const expiredOrder: CustomerOrderRow = {
    ...order,
    cancellation,
    payment,
    status: ORDER_STATUS.CANCELLED,
    timeline,
    updatedAt: timedOutAt,
  };

  await markPaymentTransactionExpired(order, timedOutAt, reason);

  // The order is now cancelled (payment never completed): free any promo-cap
  // slot it held so a single-use code is not consumed by an order the customer
  // never actually got. Best-effort — must not undo the cancel.
  await releasePromoRedemption(order.id);

  await insertDeliveryEvent({
    actorUid: null,
    details: {
      paymentStatus: paymentFailed ? PAYMENT_STATUS.FAILED : PAYMENT_STATUS.PENDING,
      timeoutMinutes,
      ...(silent ? { silent: true } : {}),
    },
    eventType: 'payment_timeout',
    orderId: order.id,
  });

  if (silent) {
    return { expired: true, order: expiredOrder };
  }

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

  return { expired: true, order: expiredOrder };
};

/**
 * Lazy expiry on read, kept alongside the scheduled sweep so any path that
 * surfaces an order also settles its fate; the returned row is the post-expiry
 * one so callers never render a stale status. Same conditional write and
 * windows as the sweep (expireUnpaidOrder). When the write loses a race the
 * order is re-read, so a payment that just landed is what the caller sees.
 */
export const maybeExpireUnpaidOrder = async (order: CustomerOrderRow): Promise<CustomerOrderRow> => {
  const nowMs = Date.now();
  if (!isUnpaidOrderExpired(order, nowMs)) {
    return order;
  }

  const result = await expireUnpaidOrder(order, nowMs);
  if (result.expired) {
    return result.order;
  }

  const { data: fresh, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq('id', order.id)
    .maybeSingle<CustomerOrderRow>();
  if (error) {
    throw new Error(error.message);
  }
  return fresh ?? order;
};

export const hasAssignedCourier = (assignment: DeliveryAssignmentRow | null) =>
  Boolean(sanitizeText(assignment?.courierId));

export const getDispatchAssignmentOwnerId = (assignment: DeliveryAssignmentRow | null) =>
  sanitizeText(assignment?.dispatchOwnerId) ?? sanitizeText(assignment?.dispatchId);
