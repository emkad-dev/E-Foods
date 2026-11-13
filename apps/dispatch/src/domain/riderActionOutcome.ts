/**
 * Whether a dispatch status action actually landed, judged from the order as
 * it is now. Pure and IO-free (explicit `.ts` specifiers so it loads under
 * `node --test --experimental-strip-types`).
 *
 * WHY. Dispatch writes are never re-sent automatically (a lost reply re-sent
 * would hit the server a second time), so a rider at the door whose "Delivered"
 * reply is lost on a bad connection sees a failure, and the retry meets the
 * status the first tap already moved: 412. After any error the delivery screen
 * reads the order and its assignment again and asks this module whether the
 * order is at or past what the action aimed for; if so, the action is reported
 * as done. The same idea as the partner screen's orderActionOutcome.
 */
import { normalizeOrderStatus, type OrderStatus } from './orders.ts';

/** The status actions the delivery screen fires (`dispatchUpdateOrderStatus`). */
export type DispatchStatusAction = 'picked_up' | 'on_the_way' | 'delivered' | 'failed_delivery' | 'escalate';

// The forward path a rider delivery walks. Statuses off it (cancelled,
// rejected, escalated, failed_delivery, draft, scheduled) are never "past" a
// forward action: an order an admin cancelled was not delivered by this tap.
const DELIVERY_PATH: OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'on_the_way',
  'delivered',
];

const FORWARD_TARGET: Record<'picked_up' | 'on_the_way' | 'delivered', OrderStatus> = {
  picked_up: 'picked_up',
  on_the_way: 'on_the_way',
  delivered: 'delivered',
};

/**
 * True when `status` is at or past what `action` aimed for. A failed delivery
 * and an escalation count only on their own status: an order that went on to
 * be delivered was not marked failed by this tap.
 */
export const hasDispatchActionReachedTarget = (
  action: DispatchStatusAction,
  status: string | null | undefined
): boolean => {
  const current = normalizeOrderStatus(status);

  if (action === 'failed_delivery') {
    return current === 'failed_delivery';
  }
  if (action === 'escalate') {
    return current === 'escalated';
  }

  const currentIndex = DELIVERY_PATH.indexOf(current);
  return currentIndex >= 0 && currentIndex >= DELIVERY_PATH.indexOf(FORWARD_TARGET[action]);
};

/** True when the rider an assignment call aimed for now holds the order. */
export const hasCourierAssignmentLanded = (
  assignment: { courierId?: string | null } | null | undefined,
  courierId: string
): boolean => Boolean(courierId) && (assignment?.courierId ?? null) === courierId;

/** The receipt shown after a status action worked. */
export const dispatchActionSuccessMessage = (action: DispatchStatusAction): string => {
  switch (action) {
    case 'picked_up':
      return 'Pickup confirmed';
    case 'on_the_way':
      return 'Marked on the way';
    case 'delivered':
      return 'Order delivered';
    case 'failed_delivery':
      return 'Marked as failed delivery';
    case 'escalate':
      return 'Delivery escalated';
  }
};
