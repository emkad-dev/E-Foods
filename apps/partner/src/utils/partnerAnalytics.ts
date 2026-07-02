import type { OrderDocument } from '../domain/entities';
import { formatOrderStatusLabel, normalizeOrderStatus } from '../domain/orders';
import { getPartnerStatusColor } from '../theme/statusColors';

export type RangeDays = 7 | 30 | 90;

export const RANGE_OPTIONS: { label: string; value: RangeDays }[] = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

const VOID_STATUSES = ['cancelled', 'rejected', 'failed_delivery'];

export const parseOrderDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const isCountedTowardRevenue = (order: OrderDocument) =>
  !VOID_STATUSES.includes(normalizeOrderStatus(order.status));

const orderTotal = (order: OrderDocument) => order.pricing?.total ?? (order as { total?: number }).total ?? 0;

const ordersBetween = (orders: OrderDocument[], start: Date, end: Date) =>
  orders.filter((order) => {
    const created = parseOrderDate(order.createdAt);
    return created !== null && created >= start && created < end;
  });

export interface PeriodComparison {
  current: number;
  previous: number;
}

export interface PartnerKpis {
  orders: PeriodComparison;
  revenue: PeriodComparison;
  avgOrder: PeriodComparison;
}

export const computePartnerKpis = (orders: OrderDocument[], rangeDays: RangeDays, now = new Date()): PartnerKpis => {
  const currentStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - 2 * rangeDays * 24 * 60 * 60 * 1000);

  const currentOrders = ordersBetween(orders, currentStart, now);
  const previousOrders = ordersBetween(orders, previousStart, currentStart);

  const revenueOf = (windowOrders: OrderDocument[]) =>
    windowOrders.reduce((total, order) => (isCountedTowardRevenue(order) ? total + orderTotal(order) : total), 0);

  const currentRevenue = revenueOf(currentOrders);
  const previousRevenue = revenueOf(previousOrders);

  return {
    orders: { current: currentOrders.length, previous: previousOrders.length },
    revenue: { current: currentRevenue, previous: previousRevenue },
    avgOrder: {
      current: currentOrders.length > 0 ? currentRevenue / currentOrders.length : 0,
      previous: previousOrders.length > 0 ? previousRevenue / previousOrders.length : 0,
    },
  };
};

export interface DeltaLabel {
  label: string;
  direction: 'up' | 'down' | 'flat';
}

export const formatDelta = (current: number, previous: number): DeltaLabel => {
  if (previous === 0) {
    if (current === 0) {
      return { label: 'No change', direction: 'flat' };
    }

    return { label: 'New activity', direction: 'up' };
  }

  const pct = ((current - previous) / previous) * 100;

  if (Math.abs(pct) < 0.5) {
    return { label: 'No change', direction: 'flat' };
  }

  const rounded = Math.abs(pct) >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return {
    label: `${pct > 0 ? '+' : ''}${rounded}% vs previous`,
    direction: pct > 0 ? 'up' : 'down',
  };
};

export interface StatusSlice {
  status: string;
  label: string;
  count: number;
  color: string;
}

// Cancelled-family statuses pin to the end; everything else ranks by volume.
export const buildPartnerStatusBreakdown = (orders: OrderDocument[], rangeDays: RangeDays, now = new Date()): StatusSlice[] => {
  const start = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const counts = new Map<string, number>();

  for (const order of ordersBetween(orders, start, now)) {
    const status = normalizeOrderStatus(order.status);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([status, count]) => ({
      status,
      label: formatOrderStatusLabel(status),
      count,
      color: getPartnerStatusColor(status),
    }))
    .sort((left, right) => {
      const leftVoid = VOID_STATUSES.includes(left.status) ? 1 : 0;
      const rightVoid = VOID_STATUSES.includes(right.status) ? 1 : 0;

      if (leftVoid !== rightVoid) {
        return leftVoid - rightVoid;
      }

      return right.count - left.count;
    });
};

export const sortOrdersByNewest = (orders: OrderDocument[]) =>
  [...orders].sort(
    (left, right) => (parseOrderDate(right.createdAt)?.getTime() ?? 0) - (parseOrderDate(left.createdAt)?.getTime() ?? 0)
  );

export const formatOrderTime = (value: unknown) => {
  const parsed = parseOrderDate(value);

  if (!parsed) {
    return '—';
  }

  return parsed.toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};
