import type { DispatchProfileDocument, OrderDocument, RestaurantDocument, UserDocument } from '../../../../packages/domain/src';
import { parseTimestamp } from './format';

export type RangeDays = 7 | 30 | 90;

export const RANGE_OPTIONS: { label: string; value: RangeDays }[] = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
];

const CLOSED_STATUSES = ['cancelled', 'delivered', 'rejected', 'failed_delivery'];
const VOID_STATUSES = ['cancelled', 'rejected', 'failed_delivery'];

export const isLiveOrder = (order: OrderDocument) => {
  const status = (order.status ?? '').toLowerCase();
  return status.length > 0 && !CLOSED_STATUSES.includes(status);
};

const isCountedTowardRevenue = (order: OrderDocument) =>
  !VOID_STATUSES.includes((order.status ?? '').toLowerCase());

export const getOrderDate = (order: OrderDocument) => parseTimestamp(order.createdAt);

const ordersBetween = (orders: OrderDocument[], start: Date, end: Date) =>
  orders.filter((order) => {
    const created = getOrderDate(order);
    return created !== null && created >= start && created < end;
  });

const sumRevenue = (orders: OrderDocument[]) =>
  orders.reduce((total, order) => (isCountedTowardRevenue(order) ? total + (order.pricing?.total ?? 0) : total), 0);

export interface PeriodComparison {
  current: number;
  previous: number;
}

export interface DashboardKpis {
  orders: PeriodComparison;
  revenue: PeriodComparison;
  newUsers: PeriodComparison;
  liveOrders: number;
  dispatchOnline: number;
  pendingApprovals: number;
  currency: string;
}

export const computeDashboardKpis = (
  orders: OrderDocument[],
  users: UserDocument[],
  restaurants: RestaurantDocument[],
  dispatchProfiles: DispatchProfileDocument[],
  rangeDays: RangeDays,
  now = new Date()
): DashboardKpis => {
  const currentStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - 2 * rangeDays * 24 * 60 * 60 * 1000);

  const currentOrders = ordersBetween(orders, currentStart, now);
  const previousOrders = ordersBetween(orders, previousStart, currentStart);

  const usersBetween = (start: Date, end: Date) =>
    users.filter((user) => {
      const created = parseTimestamp(user.createdAt);
      return created !== null && created >= start && created < end;
    }).length;

  const currency = orders.find((order) => order.pricing?.currency)?.pricing?.currency ?? 'NGN';

  return {
    orders: { current: currentOrders.length, previous: previousOrders.length },
    revenue: { current: sumRevenue(currentOrders), previous: sumRevenue(previousOrders) },
    newUsers: { current: usersBetween(currentStart, now), previous: usersBetween(previousStart, currentStart) },
    liveOrders: orders.filter(isLiveOrder).length,
    dispatchOnline: dispatchProfiles.filter((profile) =>
      ['online', 'active', 'available'].includes((profile.status ?? '').toLowerCase())
    ).length,
    pendingApprovals: restaurants.filter((restaurant) => restaurant.isPublished !== true).length,
    currency,
  };
};

export interface DailyPoint {
  key: string;
  label: string;
  orders: number;
  revenue: number;
}

export const buildDailySeries = (orders: OrderDocument[], rangeDays: RangeDays, now = new Date()): DailyPoint[] => {
  const points = new Map<string, DailyPoint>();

  for (let dayOffset = rangeDays - 1; dayOffset >= 0; dayOffset -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
    const key = day.toISOString().slice(0, 10);
    points.set(key, {
      key,
      label: day.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }),
      orders: 0,
      revenue: 0,
    });
  }

  for (const order of orders) {
    const created = getOrderDate(order);

    if (!created) {
      continue;
    }

    const key = new Date(created.getFullYear(), created.getMonth(), created.getDate()).toISOString().slice(0, 10);
    const point = points.get(key);

    if (!point) {
      continue;
    }

    point.orders += 1;

    if (isCountedTowardRevenue(order)) {
      point.revenue += order.pricing?.total ?? 0;
    }
  }

  return [...points.values()];
};

export interface BreakdownSlice {
  name: string;
  value: number;
}

// Pinned display order: confirmed first, placed second, cancelled always last;
// everything else lands in between, ranked by volume.
const STATUS_DISPLAY_PRIORITY: Record<string, number> = {
  confirmed: 0,
  placed: 1,
  cancelled: 999,
};

export const buildStatusBreakdown = (orders: OrderDocument[]): BreakdownSlice[] => {
  const counts = new Map<string, number>();

  for (const order of orders) {
    const status = (order.status ?? 'unknown').toLowerCase();
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => {
      const leftPriority = STATUS_DISPLAY_PRIORITY[left.name] ?? 100;
      const rightPriority = STATUS_DISPLAY_PRIORITY[right.name] ?? 100;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return right.value - left.value;
    });
};

// Payment lens: paid first, then the two problem states admins act on.
const PAYMENT_DISPLAY_PRIORITY: Record<string, number> = {
  paid: 0,
  pending: 1,
  failed: 2,
};

export const buildPaymentBreakdown = (orders: OrderDocument[]): BreakdownSlice[] => {
  const counts = new Map<string, number>();

  for (const order of orders) {
    const status = (order.payment?.status ?? 'unknown').toString().toLowerCase();
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => {
      const leftPriority = PAYMENT_DISPLAY_PRIORITY[left.name] ?? 100;
      const rightPriority = PAYMENT_DISPLAY_PRIORITY[right.name] ?? 100;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return right.value - left.value;
    });
};

export interface ProblemCounts {
  failedPayments: number;
  pendingPayments: number;
  cancelledOrders: number;
}

// "Problem" transactions an admin should chase: payments that failed, payments
// still pending (abandoned checkout), and orders that were cancelled. The three
// counts are independent lenses — a cancelled order with a pending payment
// counts in both — so they must not be summed into a single total.
export const computeProblemCounts = (orders: OrderDocument[]): ProblemCounts => {
  let failedPayments = 0;
  let pendingPayments = 0;
  let cancelledOrders = 0;

  for (const order of orders) {
    const paymentStatus = (order.payment?.status ?? '').toString().toLowerCase();
    if (paymentStatus === 'failed') failedPayments += 1;
    if (paymentStatus === 'pending') pendingPayments += 1;
    if ((order.status ?? '').toLowerCase() === 'cancelled') cancelledOrders += 1;
  }

  return { failedPayments, pendingPayments, cancelledOrders };
};

export interface ProblemDailyPoint {
  key: string;
  label: string;
  failed: number;
  pending: number;
  cancelled: number;
}

export const buildProblemDailySeries = (
  orders: OrderDocument[],
  rangeDays: RangeDays,
  now = new Date()
): ProblemDailyPoint[] => {
  const points = new Map<string, ProblemDailyPoint>();

  for (let dayOffset = rangeDays - 1; dayOffset >= 0; dayOffset -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
    const key = day.toISOString().slice(0, 10);
    points.set(key, {
      key,
      label: day.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }),
      failed: 0,
      pending: 0,
      cancelled: 0,
    });
  }

  for (const order of orders) {
    const created = getOrderDate(order);

    if (!created) {
      continue;
    }

    const key = new Date(created.getFullYear(), created.getMonth(), created.getDate()).toISOString().slice(0, 10);
    const point = points.get(key);

    if (!point) {
      continue;
    }

    const paymentStatus = (order.payment?.status ?? '').toString().toLowerCase();
    if (paymentStatus === 'failed') point.failed += 1;
    if (paymentStatus === 'pending') point.pending += 1;
    if ((order.status ?? '').toLowerCase() === 'cancelled') point.cancelled += 1;
  }

  return [...points.values()];
};

export const buildTopRestaurants = (orders: OrderDocument[], limit = 6): { name: string; orders: number; revenue: number }[] => {
  const byRestaurant = new Map<string, { name: string; orders: number; revenue: number }>();

  for (const order of orders) {
    const key = order.restaurantId || order.restaurantName || 'unknown';
    const entry = byRestaurant.get(key) ?? { name: order.restaurantName || 'Unknown restaurant', orders: 0, revenue: 0 };
    entry.orders += 1;

    if (isCountedTowardRevenue(order)) {
      entry.revenue += order.pricing?.total ?? 0;
    }

    byRestaurant.set(key, entry);
  }

  return [...byRestaurant.values()].sort((left, right) => right.revenue - left.revenue).slice(0, limit);
};

export const buildZoneBreakdown = (dispatchProfiles: DispatchProfileDocument[]): BreakdownSlice[] => {
  const counts = new Map<string, number>();

  for (const profile of dispatchProfiles) {
    const zone = (profile.zone ?? profile.currentZone ?? profile.region ?? 'Unassigned').toString().trim() || 'Unassigned';
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value);
};
