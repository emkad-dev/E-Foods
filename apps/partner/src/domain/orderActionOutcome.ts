// What a partner order action aimed for, and whether the order got there. Pure so
// the partner order screen's "did it actually work?" decision is testable
// without rendering it.
//
// WHY. An action can fail on the phone and still have succeeded on the server:
// the reply is lost on a bad connection, or a second tap meets the status the
// first one already moved. The screen used to pin "Update failed" over an order
// that HAD been collected, telling a kitchen to redo finished work. After an
// error it now reloads the order and asks this module whether the order is at or
// past what the action wanted; if so, the action is reported as done.

import { formatOrderStatusLabel, normalizeOrderStatus, type OrderStatus } from '../../../../packages/domain/src/orders.ts';

/** The five transitions the partner order screen can fire. */
export type PartnerOrderAction = 'accept' | 'preparing' | 'ready' | 'delivered' | 'reject';

const isPickup = (fulfillmentType: string | null | undefined) => (fulfillmentType ?? 'delivery') === 'pickup';

// The forward path an order walks, in order. A pickup order skips the rider
// steps: the restaurant marks it collected, which is stored as `delivered`.
// Statuses off the path (cancelled, rejected, failed_delivery, escalated, draft,
// scheduled) are never "past" a forward action: an order that was cancelled was
// not accepted by this tap.
const DELIVERY_PATH: OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'on_the_way',
  'delivered',
];
const PICKUP_PATH: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'delivered'];

const FORWARD_TARGET: Record<Exclude<PartnerOrderAction, 'reject'>, OrderStatus> = {
  accept: 'accepted',
  preparing: 'preparing',
  ready: 'ready_for_pickup',
  delivered: 'delivered',
};

/**
 * True when `status` is at or past the status `action` aimed for, so the action
 * can be treated as done even though the call that sent it failed.
 *
 * Reject counts only when the order is `rejected`. An order that ended up
 * `cancelled` was not rejected by this tap (the customer or the deadline sweep
 * ended it), so "Order rejected" would be untrue; see `resolveFailedOrderAction`.
 */
export const hasOrderReachedActionTarget = (
  action: PartnerOrderAction,
  status: string | null | undefined,
  fulfillmentType: string | null | undefined
): boolean => {
  const current = normalizeOrderStatus(status);

  if (action === 'reject') {
    return current === 'rejected';
  }

  const path = isPickup(fulfillmentType) ? PICKUP_PATH : DELIVERY_PATH;
  const currentIndex = path.indexOf(current);
  if (currentIndex < 0) {
    return false;
  }

  return currentIndex >= path.indexOf(FORWARD_TARGET[action]);
};

/**
 * What the screen does after an action's call failed and the order was read
 * again:
 * - `done`: the order got where the action aimed, so report success.
 * - `cancelled`: a reject met an order that is already cancelled. Nothing is
 *   left to reject, so neither success nor failure is true; the screen says the
 *   order was cancelled and closes as it would after a reject.
 * - `failed`: show the failure notice.
 */
export type FailedOrderActionOutcome = 'done' | 'cancelled' | 'failed';

export const resolveFailedOrderAction = (
  action: PartnerOrderAction,
  status: string | null | undefined,
  fulfillmentType: string | null | undefined
): FailedOrderActionOutcome => {
  if (hasOrderReachedActionTarget(action, status, fulfillmentType)) {
    return 'done';
  }

  return action === 'reject' && normalizeOrderStatus(status) === 'cancelled' ? 'cancelled' : 'failed';
};

/** The neutral notice for a reject that found the order already cancelled. */
export const ORDER_ALREADY_CANCELLED_MESSAGE = 'This order was cancelled.';

/** The receipt shown after an action worked, worded for what actually happened. */
export const orderActionSuccessMessage = (
  action: PartnerOrderAction,
  fulfillmentType: string | null | undefined
): string => {
  const pickup = isPickup(fulfillmentType);

  switch (action) {
    case 'accept':
      return 'Order accepted';
    case 'preparing':
      return 'Marked as preparing';
    case 'ready':
      return pickup ? 'Marked ready for pickup' : 'Marked ready';
    case 'delivered':
      return pickup
        ? 'Order collected. Waiting for the customer to confirm.'
        : 'Order delivered. Waiting for the customer to confirm.';
    case 'reject':
      return 'Order rejected';
  }
};

/**
 * The status label partner screens show. The stored status of a collected
 * pickup order is `delivered`, but nothing was delivered: the customer came and
 * took it, so it reads "Collected". Every other status reads as before.
 */
export const formatPartnerOrderStatusLabel = (
  status: string | null | undefined,
  fulfillmentType: string | null | undefined
): string =>
  isPickup(fulfillmentType) && normalizeOrderStatus(status) === 'delivered' ? 'Collected' : formatOrderStatusLabel(status);
