import { normalizeOrderStatus, TERMINAL_ORDER_STATUSES } from './orders.ts';

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
