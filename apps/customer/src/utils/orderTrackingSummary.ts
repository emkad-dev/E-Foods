import type { OrderDocument } from '../domain/entities';

export type OrderTrackingSummaryLine = {
  id: string;
  isPrimary: boolean;
  itemCount: number;
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
