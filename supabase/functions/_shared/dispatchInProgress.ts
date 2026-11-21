import { normalizeOrderStatus, ORDER_STATUS, TERMINAL_ORDER_STATUSES } from './orders.ts';

// Statuses at which a FEASTY rider can hold an order: dispatch assigns from
// accepted/preparing/ready_for_pickup (UNOWNED_DISPATCHABLE_STATUSES in
// domains/dispatch.ts, AUTO_DISPATCH_ELIGIBLE_STATUSES in dispatchSelection.ts),
// the rider then moves it to picked_up -> on_the_way, and an escalated order
// can still carry its rider. 'ready' is the legacy raw spelling that
// normalizeOrderStatus maps to ready_for_pickup. draft/unpaid/placed/scheduled
// never hold a rider, so they stay out of the query.
export const RIDER_HELD_ORDER_STATUSES: readonly string[] = [
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
  'ready',
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.ON_THE_WAY,
  ORDER_STATUS.ESCALATED,
];

// How many rider-held orders the ops view looks at, and how many order ids go
// into one DeliveryAssignment `.in()` read (keeps the request URL short).
export const IN_PROGRESS_ORDER_LIMIT = 500;
export const IN_PROGRESS_ASSIGNMENT_CHUNK = 100;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export type InProgressOrderInput = {
  id: string;
  status: string;
  restaurantName: string | null;
  updatedAt: string | null;
};

export type InProgressAssignmentInput = {
  orderId: string;
  courierId: string | null;
  courierName: string | null;
  assignedAt: string | null;
};

export type InProgressDelivery = {
  orderId: string;
  status: string;
  restaurantName: string | null;
  courierId: string | null;
  courierName: string | null;
  assignedAt: string | null;
  updatedAt: string | null;
};

// Joins non-terminal orders to their delivery assignment. Orders with no
// assignment, or whose normalized status is terminal, are dropped. Oldest
// assignedAt first (longest on the road = most likely stuck); a missing
// assignedAt sorts last.
export function buildInProgressDeliveries(
  orders: InProgressOrderInput[],
  assignments: InProgressAssignmentInput[],
): InProgressDelivery[] {
  const byOrderId = new Map<string, InProgressAssignmentInput>();
  for (const assignment of assignments) {
    // An assignment row with no rider (null/blank courierId) is unassigned.
    if (!assignment.courierId || assignment.courierId.trim() === '') continue;
    byOrderId.set(assignment.orderId, assignment);
  }

  const rows: InProgressDelivery[] = [];
  for (const order of orders) {
    const assignment = byOrderId.get(order.id);
    if (!assignment) continue;
    const status = normalizeOrderStatus(order.status);
    if (TERMINAL_ORDER_STATUSES.has(status)) continue;
    rows.push({
      orderId: order.id,
      status,
      restaurantName: order.restaurantName ?? null,
      courierId: assignment.courierId ?? null,
      courierName: assignment.courierName ?? null,
      assignedAt: assignment.assignedAt ?? null,
      updatedAt: order.updatedAt ?? null,
    });
  }

  const time = (value: string | null) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return rows.sort((a, b) => {
    const ta = time(a.assignedAt);
    const tb = time(b.assignedAt);
    if (ta === tb) return 0;
    return ta < tb ? -1 : 1;
  });
}
