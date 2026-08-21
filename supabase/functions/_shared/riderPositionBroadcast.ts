// Fan-out of a rider's live position to the customer(s) currently waiting on
// that rider. Called from syncDispatchRiderLocation ONLY when a ping was
// actually recorded (pingResult.recorded === true), which inherits the
// SQL-enforced 10s-per-rider throttle for free - one broadcast per 10s per
// order, no second timer.
//
// The broadcast target is the rider's ACTIVE order(s): those where this rider
// is the assigned courier AND the order is out for delivery (picked_up /
// on_the_way). Before pickup there is no rider moving toward the customer, so
// there is nothing to show and nothing is broadcast.
//
// Security: the payload carries ONLY coordinates + a coarse timestamp (see
// broadcastRiderPosition's whitelist). DispatchRiderPing itself stays
// service-role-only; the customer never reads it.

import { serviceClient } from './client.ts';
import { ORDER_STATUS } from './orders.ts';
import { broadcastRiderPosition, type RiderPositionPayload } from './realtime.ts';

/** Order states in which a rider is en route and the customer sees the map. */
export const RIDER_ACTIVE_DELIVERY_STATUSES: readonly string[] = [
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.ON_THE_WAY,
];

/**
 * Order ids this rider currently holds an ACTIVE delivery assignment for
 * (courier === rider AND order status in RIDER_ACTIVE_DELIVERY_STATUSES).
 * Two small reads, run at most once per 10s per rider (gated by the ping
 * throttle upstream).
 */
export const loadRiderActiveOrderIds = async (riderId: string): Promise<string[]> => {
  const { data: assignments, error: assignmentError } = await serviceClient
    .from('DeliveryAssignment')
    .select('orderId')
    .eq('courierId', riderId);

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  const assignedOrderIds = Array.from(
    new Set(
      ((assignments ?? []) as { orderId?: string | null }[])
        .map((row) => (typeof row.orderId === 'string' ? row.orderId : ''))
        .filter((orderId) => orderId.length > 0)
    )
  );

  if (assignedOrderIds.length === 0) {
    return [];
  }

  const { data: orders, error: orderError } = await serviceClient
    .from('CustomerOrder')
    .select('id,status')
    .in('id', assignedOrderIds)
    .in('status', RIDER_ACTIVE_DELIVERY_STATUSES as string[]);

  if (orderError) {
    throw new Error(orderError.message);
  }

  return ((orders ?? []) as { id?: string | null }[])
    .map((row) => (typeof row.id === 'string' ? row.id : ''))
    .filter((id) => id.length > 0);
};

export type BroadcastRiderPositionArgs = {
  riderId: string;
  latitude: number;
  longitude: number;
  updatedAt: string | null;
  // Injectable for tests: the real dependencies default in, so the handler
  // wires nothing, while a test drives this out of the real domain map with a
  // mock loader (returning a snapshot, not a live row) and a spy broadcaster
  // that captures the exact payload emitted.
  loadActiveOrderIds?: (riderId: string) => Promise<string[]>;
  broadcast?: (orderId: string, position: RiderPositionPayload) => Promise<void> | void;
};

/**
 * Resolves the rider's active orders and broadcasts the whitelisted position
 * payload to each `order-<id>` topic. Returns the order ids it broadcast to
 * (so a caller/test can assert the fan-out). The payload is assembled here
 * from the three whitelisted fields only - never from a spread row.
 */
export const broadcastRiderPositionToActiveOrders = async ({
  riderId,
  latitude,
  longitude,
  updatedAt,
  loadActiveOrderIds = loadRiderActiveOrderIds,
  broadcast = broadcastRiderPosition,
}: BroadcastRiderPositionArgs): Promise<string[]> => {
  const orderIds = await loadActiveOrderIds(riderId);
  if (orderIds.length === 0) {
    return [];
  }

  const position: RiderPositionPayload = {
    latitude,
    longitude,
    updatedAt: updatedAt ?? null,
  };

  for (const orderId of orderIds) {
    await broadcast(orderId, position);
  }

  return orderIds;
};
