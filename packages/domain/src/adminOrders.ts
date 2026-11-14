/**
 * Admin order rules shared by the edge functions (the admin RPC handlers and
 * reads) and the admin web console, so the buttons it offers and the actions
 * the server accepts cannot disagree, and the figures it shows are computed one
 * way.
 *
 * Imports nothing: it runs under Deno, Node's test runner and Vite alike.
 * Statuses are expected NORMALIZED (the server's normalizeOrderStatus; the
 * admin reads already return normalized statuses).
 */

type OrderStatusLike = string | null | undefined;

const TERMINAL_STATUSES: readonly string[] = ['delivered', 'cancelled', 'rejected', 'failed_delivery'];

/** Kitchen stages from which an admin may complete a pickup or a restaurant-run delivery. */
export const ADMIN_FORCE_COMPLETE_KITCHEN_STATUSES: readonly string[] = ['accepted', 'preparing', 'ready_for_pickup'];

/** A FEASTY rider holds the order: completing it early is allowed only once the rider is on the way. */
export const ADMIN_FORCE_COMPLETE_PLATFORM_STATUSES: readonly string[] = ['on_the_way'];

/** Free text an admin gives for a force action or a report resolution. */
export const ADMIN_ORDER_NOTE_MAX_LENGTH = 500;

const isPlatformDelivery = (order: { fulfillmentType?: string | null; pricing?: unknown }) => {
  if ((order.fulfillmentType ?? 'delivery') !== 'delivery') {
    return false;
  }
  const pricing = order.pricing;
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
    return false;
  }
  const provider = (pricing as Record<string, unknown>).deliveryProvider;
  return typeof provider === 'string' && provider.trim() === 'platform';
};

/** Any order that has not ended can be cancelled by an admin. */
export const canAdminForceCancelOrder = (order: { status?: OrderStatusLike }): boolean =>
  typeof order.status === 'string' && order.status !== '' && !TERMINAL_STATUSES.includes(order.status);

/**
 * Pickups and restaurant-run deliveries can be completed from the kitchen
 * stages. A FEASTY rider's delivery ends with the customer's handoff code, so an
 * admin may only complete it once the rider is on the way (the code or the
 * rider's phone failed at the door), never before the food left the kitchen.
 */
export const canAdminForceCompleteOrder = (order: {
  fulfillmentType?: string | null;
  pricing?: unknown;
  status?: OrderStatusLike;
}): boolean => {
  const status = order.status ?? '';
  return isPlatformDelivery(order)
    ? ADMIN_FORCE_COMPLETE_PLATFORM_STATUSES.includes(status)
    : ADMIN_FORCE_COMPLETE_KITCHEN_STATUSES.includes(status);
};

/**
 * Every flagged order has a way out: an admin marks it resolved with a note.
 * The flag is raised by a customer problem report, a late payment on a closed
 * order, a refund to return by hand, or the acceptance escalation, and any of
 * those may outlive the order's last status change. Resolving changes no
 * status, so it applies to terminal orders too.
 */
export const canAdminResolveOrderReport = (order: { needsAttention?: boolean | null }): boolean =>
  order.needsAttention === true;

/**
 * The orders a human must look at. needsAttention is the only test, whatever
 * the status: a late payment on a cancelled order or a refund to return by hand
 * on a rejected one is exactly when someone must act, and the reporting filter
 * that hides closed orders would otherwise hide these too.
 */
export const selectAttentionOrders = <T extends { needsAttention?: boolean | null }>(orders: readonly T[]): T[] =>
  orders.filter((order) => order.needsAttention === true);

const readNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const readObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Still moving: paid and not yet delivered, so it may still be rejected or cancelled. */
const IN_PROGRESS_STATUSES: readonly string[] = [
  'scheduled',
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'on_the_way',
  'escalated',
];

export type RestaurantOwedEntry = {
  /** The restaurant share of the order: what the Paystack split sends, or what must be paid out by hand. */
  amount: number;
  /** 'owed': delivered and still paid. 'pending': paid, still in progress. */
  kind: 'owed' | 'pending';
  restaurantId: string;
  /** 'split' (paid out at source), 'manual' (the platform holds it) or null (not recorded). */
  settlementMode: 'manual' | 'split' | null;
};

/**
 * What one order means for its restaurant's payout, or null when it counts in
 * neither figure.
 *   owed    - status delivered and the payment still paid.
 *   pending - payment paid, order still in progress (it may yet be rejected or
 *             cancelled, so it is not owed yet).
 * Anything else counts nowhere: an unpaid or refunded payment (a refund means
 * the money is going back to the customer), and failed_delivery, cancelled or
 * rejected orders.
 *
 * The amount is the settlement the checkout computed: netSettlement (the
 * restaurant payable plus the delivery fee when the restaurant delivers), the
 * same figure the split sends, falling back to restaurantPayable for rows that
 * carry only that. Never the gross payment, which also holds the platform fee,
 * the tip and a FEASTY rider's delivery fee.
 */
export const restaurantOwedForOrder = (order: {
  payment?: unknown;
  pricing?: unknown;
  restaurantId?: string | null;
  status?: OrderStatusLike;
}): RestaurantOwedEntry | null => {
  const restaurantId = (order.restaurantId ?? '').trim();
  const payment = readObject(order.payment);
  if (!restaurantId || payment.status !== 'paid') {
    return null;
  }
  const status = order.status ?? '';
  const kind = status === 'delivered' ? 'owed' : IN_PROGRESS_STATUSES.includes(status) ? 'pending' : null;
  if (!kind) {
    return null;
  }
  const pricing = readObject(order.pricing);
  const settlement = readObject(pricing.settlement);
  const amount =
    readNumber(pricing.netSettlement) ?? readNumber(settlement.netSettlement) ?? readNumber(pricing.restaurantPayable) ?? 0;
  const mode = payment.settlementMode;
  return {
    amount: Math.max(amount, 0),
    kind,
    restaurantId,
    settlementMode: mode === 'split' || mode === 'manual' ? mode : null,
  };
};

export type PendingTotals = { amount: number; count: number };

/** Count and amount of in-progress paid orders, per restaurant and platform-wide. */
export const summarizePendingPayouts = (entries: readonly RestaurantOwedEntry[]) => {
  const byRestaurant = new Map<string, PendingTotals>();
  const platform: PendingTotals = { amount: 0, count: 0 };
  const add = (totals: PendingTotals, amount: number) => {
    totals.count += 1;
    totals.amount = Math.round((totals.amount + amount) * 100) / 100;
  };
  for (const entry of entries) {
    if (entry.kind !== 'pending') {
      continue;
    }
    add(platform, entry.amount);
    const totals = byRestaurant.get(entry.restaurantId) ?? { amount: 0, count: 0 };
    add(totals, entry.amount);
    byRestaurant.set(entry.restaurantId, totals);
  }
  return { byRestaurant, platform };
};
