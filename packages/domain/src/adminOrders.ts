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

/** A customer problem report is open until an admin resolves it (which clears the flag). */
export const canAdminResolveOrderReport = (order: {
  customerIssueReportedAt?: string | null;
  needsAttention?: boolean | null;
}): boolean => Boolean(order.customerIssueReportedAt) && order.needsAttention === true;

/**
 * The orders a human must look at. needsAttention is the only test, whatever
 * the status: a late payment on a cancelled order or a refund to return by hand
 * on a rejected one is exactly when someone must act, and the reporting filter
 * that hides closed orders would otherwise hide these too.
 */
export const selectAttentionOrders = <T extends { needsAttention?: boolean | null }>(orders: readonly T[]): T[] =>
  orders.filter((order) => order.needsAttention === true);

/** Closed without being served: nothing is owed to the restaurant. */
const UNSERVED_STATUSES: readonly string[] = ['cancelled', 'rejected'];

const readNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const readObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export type RestaurantOwedEntry = {
  /** The restaurant share of the order: what the Paystack split sends, or what must be paid out by hand. */
  amount: number;
  restaurantId: string;
  /** 'split' (paid out at source), 'manual' (the platform holds it) or null (not recorded). */
  settlementMode: 'manual' | 'split' | null;
};

/**
 * What one order owes its restaurant, or null when it owes nothing: the payment
 * is not paid (pending, failed, or refunded - a refund means the money is going
 * back to the customer) or the order was cancelled or rejected.
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
  if (!restaurantId || payment.status !== 'paid' || UNSERVED_STATUSES.includes(order.status ?? '')) {
    return null;
  }
  const pricing = readObject(order.pricing);
  const settlement = readObject(pricing.settlement);
  const amount =
    readNumber(pricing.netSettlement) ?? readNumber(settlement.netSettlement) ?? readNumber(pricing.restaurantPayable) ?? 0;
  const mode = payment.settlementMode;
  return {
    amount: Math.max(amount, 0),
    restaurantId,
    settlementMode: mode === 'split' || mode === 'manual' ? mode : null,
  };
};
