import type { OrderDocument, OrderItemDocument, OrderPriceBreakdown } from '../domain/entities';
// ONE definition of how an order is worded. This was implemented here and
// again, identically, in apps/partner for the kitchen ticket -- two copies of
// that rule is a promise the receipt and the ticket eventually disagree about
// what was ordered, and the divergence would surface as a support call rather
// than a failing test.
//
// Reached through the package path with an explicit extension rather than the
// local `../domain/orders` shim: this module is executed directly by
// `node --test --experimental-strip-types`, which does no extension guessing,
// and that shim re-exports its target extensionlessly. Same reason
// profileSummary.ts reaches past it.
import { formatOrderItemOptions } from '../../../../packages/domain/src/orders.ts';

/** One ordered line, ready to print: what it was, how many, what it cost. */
export type OrderTrackingSummaryItem = {
  /** React key. NOT the menu item id: the same dish ordered twice with
   *  different modifiers is two `OrderItem` rows sharing one `itemId`, so the
   *  position has to be part of the key or React collapses them. */
  key: string;
  name: string;
  /** The customer's modifier choices, or null when the line was ordered plain. */
  options: string | null;
  quantity: number;
  /** price × quantity. `price` is already the customer-facing unit price with
   *  the platform markup and the modifier delta folded in (see
   *  `supabase/functions/_shared/domains/orders.ts`), so nothing is re-derived
   *  here — that is what makes these lines sum to `pricing.subtotal`. */
  total: number;
};

export type OrderTrackingSummaryLine = {
  id: string;
  isPrimary: boolean;
  itemCount: number;
  /** The restaurant's own lines. Carried on the line rather than re-derived on
   *  the screen so the "which items belong to which restaurant" rule lives in
   *  exactly one place — a mixed-basket order that showed one flat list would
   *  tell the customer the wrong kitchen is making their food. */
  items: OrderTrackingSummaryItem[];
  restaurantName: string;
  subtotal: number;
};

export type OrderTrackingSummary = {
  groupOrderCount: number;
  lines: OrderTrackingSummaryLine[];
  orderCount: number;
  restaurantCount: number;
  subtitle: string;
  title: string;
  total: number;
  totalLabel: string;
};

const countItems = (items: OrderDocument['items']) =>
  items.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0), 0);

const formatCountLabel = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;

const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Kobo-precision rounding, matching `roundCurrency` in the pricing module so a
 *  receipt assembled here balances against a total computed there. */
const roundCurrency = (value: number) => Math.round(value * 100) / 100;

// Re-exported so the screens and tests that already reach for it here keep
// working; the definition itself is shared (see the import at the top).
export { formatOrderItemOptions };

/**
 * The printable lines of one restaurant's order.
 *
 * Returns `[]` — never a placeholder row — for a legacy order whose `items` are
 * absent, so the screen can suppress the whole section rather than render an
 * "Items" heading over nothing.
 */
export const buildOrderItemRows = (items: OrderDocument['items'] | null | undefined): OrderTrackingSummaryItem[] => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item): item is OrderItemDocument => Boolean(item) && typeof item?.name === 'string' && item.name.trim().length > 0)
    .map((item, index) => {
      const quantity = toFiniteNumber(item.quantity, 0);
      const price = toFiniteNumber(item.price, 0);

      return {
        key: `${typeof item.id === 'string' && item.id ? item.id : 'item'}:${index}`,
        name: item.name.trim(),
        options: formatOrderItemOptions(item),
        quantity,
        total: roundCurrency(price * quantity),
      };
    });
};

/** One row of the money summary. A deduction carries a negative `amount` so the
 *  column the customer reads down actually sums to the total printed above it. */
export type OrderReceiptLine = {
  id: string;
  label: string;
  amount: number;
};

export type OrderReceipt = {
  lines: OrderReceiptLine[];
  /** Σ lines − total, to the kobo. 0 when the receipt adds up. Exists so the
   *  identity is asserted by a test instead of eyeballed: the screen used to
   *  print delivery fee and tip with no subtotal and no discount, which cannot
   *  reconcile to the total by construction, and nothing caught it. */
  residual: number;
  total: number;
};

/**
 * The money lines for one restaurant's order, in reading order.
 *
 * Every value here is already on `pricing` as the server wrote it
 * (`calculateOrderPricing`), which computes
 * `total = subtotal + deliveryFee + tip − discount`. Printing subtotal and
 * discount is what closes the gap; nothing is invented.
 *
 * Suppression rules, each guarding a line that would otherwise be noise:
 * - subtotal: omitted when `pricing` carries none (legacy rows). The receipt
 *   then cannot balance, and `residual` says so rather than a fabricated figure.
 * - service fee: omitted at 0. `calculateOrderPricing` hard-codes `serviceFee: 0`
 *   under pricing v2 — the markup is inside the menu price and there is no
 *   separate charge — so this row only ever appears on commission-era orders
 *   that really were charged one.
 * - discount: omitted at 0, so an order with no promo shows no promo line.
 * Delivery fee and tip always print: ₦0.00 there is a statement (no fee, no tip
 * left), not an absence.
 */
export const buildOrderReceipt = ({
  pricing,
  restaurantScoped,
  total,
}: {
  pricing: OrderPriceBreakdown | null | undefined;
  /** True when this order is one member of a grouped checkout, which prefixes
   *  each label so it cannot be mistaken for the group-wide figure above it. */
  restaurantScoped: boolean;
  total: number;
}): OrderReceipt => {
  const prefix = (label: string) => (restaurantScoped ? `Restaurant ${label.toLowerCase()}` : label);
  const lines: OrderReceiptLine[] = [];

  const subtotal = typeof pricing?.subtotal === 'number' && Number.isFinite(pricing.subtotal) ? pricing.subtotal : null;
  if (subtotal !== null) {
    lines.push({ amount: subtotal, id: 'subtotal', label: prefix('Subtotal') });
  }

  lines.push({ amount: toFiniteNumber(pricing?.deliveryFee, 0), id: 'deliveryFee', label: prefix('Delivery fee') });

  const serviceFee = toFiniteNumber(pricing?.serviceFee, 0);
  if (serviceFee > 0) {
    lines.push({ amount: serviceFee, id: 'serviceFee', label: prefix('Service fee') });
  }

  lines.push({ amount: toFiniteNumber(pricing?.tip, 0), id: 'tip', label: prefix('Tip') });

  const discount = toFiniteNumber(pricing?.discount, 0);
  if (discount > 0) {
    lines.push({ amount: -discount, id: 'discount', label: prefix('Discount') });
  }

  const resolvedTotal = toFiniteNumber(total, 0);

  return {
    lines,
    residual: roundCurrency(lines.reduce((sum, line) => sum + line.amount, 0) - resolvedTotal),
    total: resolvedTotal,
  };
};

export const buildOrderTrackingSummary = (order: OrderDocument): OrderTrackingSummary | null => {
  const orderGroup = order.orderGroup;
  const groupedOrders = Array.isArray(order.groupOrders) ? order.groupOrders.filter((groupOrder): groupOrder is OrderDocument => Boolean(groupOrder)) : [];
  const orderGroupOrderCount = toFiniteNumber(orderGroup?.orderCount, 0);
  const orderGroupRestaurantCount = toFiniteNumber(
    Array.isArray(orderGroup?.restaurantIds) ? orderGroup.restaurantIds.length : orderGroup?.restaurantCount,
    0
  );
  const hasGroup = groupedOrders.length > 1 || orderGroupOrderCount > 1 || orderGroupRestaurantCount > 1;

  if (!hasGroup) {
    return null;
  }

  const sourceOrders = groupedOrders.length > 0 ? groupedOrders : [order];
  const restaurantCount =
    orderGroupRestaurantCount ||
    new Set(sourceOrders.map((groupOrder) => groupOrder.restaurantId)).size;
  const orderCount = orderGroupOrderCount || sourceOrders.length;
  const total = toFiniteNumber(orderGroup?.pricing?.total, toFiniteNumber(order.pricing?.total, toFiniteNumber(order.total, 0)));
  const lines = sourceOrders.map((groupOrder) => ({
    id: groupOrder.id ?? order.id ?? groupOrder.restaurantId,
    isPrimary: (orderGroup?.primaryOrderId ?? order.id ?? null) === groupOrder.id,
    itemCount: countItems(groupOrder.items ?? []),
    items: buildOrderItemRows(groupOrder.items),
    restaurantName: groupOrder.restaurantName,
    subtotal: toFiniteNumber(groupOrder.pricing?.subtotal, toFiniteNumber(groupOrder.total, 0)),
  }));

  return {
    groupOrderCount: sourceOrders.length,
    lines,
    orderCount,
    restaurantCount,
    subtitle: `${formatCountLabel(orderCount, 'restaurant order', 'restaurant orders')} across ${formatCountLabel(
      restaurantCount,
      'restaurant',
      'restaurants'
    )}`,
    title: 'Grouped checkout',
    total,
    totalLabel: 'Group total',
  };
};
