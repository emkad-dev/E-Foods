// The acceptance-deadline sweep (Task 14 / E3), run by queue-drainer on the
// every-minute pg_cron schedule that already exists
// (20260624_queue_drainer_schedule.sql posts {"queue":"all"} - no new cron
// entry, no new secret, no new schedule to keep alive).
//
// It closes the path where a paid customer waits forever because a restaurant
// never opened the app: an order that has sat 'placed' too long is first
// escalated (admin paged, order flagged needsAttention), then - at 2x the
// deadline - auto-cancelled with a FULL refund and the miss counted on the
// restaurant.
//
// THE SWEEP-VS-ACCEPT RACE is closed by two compare-and-swap SQL functions,
// NOT by the status this sweep read. This function reads a candidate order,
// decides its stage, and then calls a CAS that re-checks the order's COMMITTED
// status under a row lock and acts only if it is STILL 'placed'
// (20260821_order_acceptance_deadline.sql). If a restaurant accepted the order
// between this sweep's read and the CAS's write, the CAS no-ops: no escalation,
// no cancel, no refund, no missed-count bump. The stale snapshot this function
// holds is never trusted at write time - it only decides which CAS to attempt.
//
// IDEMPOTENCE:
//   * escalation's once-guard is the needsAttention flag, flipped by a CAS
//     (`where not coalesce(needsAttention, false)`): a second sweep flips
//     nothing and pages nobody.
//   * auto-cancel's guard is `status = 'placed'`: a second sweep over an
//     already-cancelled order matches nothing and refunds nothing.
//   * the refund is recorded-only into the order's payment ledger (the same
//     mechanism cancelCustomerOrder uses via buildRefundUpdate), so even a
//     hypothetical double-write would be the same idempotent payload.
//
// Nothing here throws to the caller. queue-drainer's own job draining must not
// fail because the acceptance sweep had a bad minute, and a single bad order
// must not abort the batch - both mirror sweepDispatchOffers.

import { buildRefundUpdate } from './domains/orders.ts';
import {
  buildNotificationData,
  notifyAdmins,
  notifyRestaurantUsers,
  notifyUsers,
} from './notifications.ts';
import { logEdgeEvent } from './observability.ts';
import {
  CUSTOMER_ORDER_COLUMNS,
  type CustomerOrderRow,
  insertDeliveryEvent,
  isOrderOperationallyVisible,
  normalizeOrderStatus,
  ORDER_STATUS,
  releasePromoRedemption,
} from './orders.ts';
import { loadAcceptanceDeadlineConfig } from './platformSettings.ts';
import { broadcastOrderChanged } from './realtime.ts';
import { nowIso, toSortableTimestamp } from './rpc/coercion.ts';
import { serviceClient } from './client.ts';

/** The actor recorded on events the sweep causes. Not a real uid - there is no human here. */
export const ACCEPTANCE_DEADLINE_SWEEP_ACTOR = 'system:acceptance-deadline-sweep';

/** The full refund rate applied at auto-cancel: the customer did nothing wrong,
 * so the normal status-based rate (getCustomerCancellationRefundRate) does NOT
 * apply - it is bypassed entirely and forced to 1.0 (100%). */
const ACCEPTANCE_FULL_REFUND_RATE = 1;

/** Bounded per run: placed orders awaiting acceptance are few and short-lived,
 * and the sweep is idempotent, so a straggler beyond this cap is simply picked
 * up next minute. Keeps the sweep from ever running unbounded. */
const ACCEPTANCE_SWEEP_LIMIT = 100;

/** Statuses that normalize to 'placed' - the candidate set to consider. The CAS
 * re-normalizes and re-guards under a lock; this is only the coarse pre-filter. */
const PLACED_LIKE_STATUSES = ['placed', 'pending', 'confirmed'];

export type AcceptanceDeadlineSweepResult = {
  /** Orders this run escalated (flag flipped false->true this run). */
  escalated: number;
  /** Orders this run auto-cancelled + refunded in full. */
  cancelled: number;
  /** Candidates that produced no state change (not yet due, already escalated,
   * raced out of 'placed', unpaid prepaid, or malformed). */
  skipped: number;
};

/** postgrest rpc returning a `table(...)` hands back an array of rows; a scalar
 * shape hands back the row. Mirror dispatchSelection's tolerant unwrap. */
const firstRpcRow = <T>(data: unknown): T | null => {
  if (Array.isArray(data)) {
    return (data[0] as T) ?? null;
  }
  return (data as T) ?? null;
};

const escalateOrder = async (order: CustomerOrderRow, result: AcceptanceDeadlineSweepResult) => {
  const { data, error } = await serviceClient.rpc('ebuy_escalate_unaccepted_order', {
    p_order_id: order.id,
  });

  if (error) {
    throw new Error(error.message);
  }

  const escalated = firstRpcRow<{ escalated?: boolean }>(data)?.escalated === true;
  if (!escalated) {
    // Already flagged by an earlier sweep, or the order left 'placed' between
    // the candidate read and the CAS - either way nothing to page about.
    result.skipped += 1;
    return;
  }

  result.escalated += 1;

  // Best-effort beyond the flag flip: the flag is the once-guard, so a failed
  // event insert or push here is not retried (and must not undo the cancel-safe
  // flag), but it also must never throw out of the sweep.
  try {
    await insertDeliveryEvent({
      actorUid: ACCEPTANCE_DEADLINE_SWEEP_ACTOR,
      details: { restaurantId: order.restaurantId },
      eventType: 'acceptance_deadline_escalated',
      orderId: order.id,
    });
  } catch (eventError) {
    logEdgeEvent('error', 'acceptance escalation event insert failed', {
      error: eventError instanceof Error ? eventError.message : String(eventError),
      orderId: order.id,
    });
  }

  // notifyAdmins is best-effort internally (notifySafely) - it will not throw.
  await notifyAdmins({
    body: `Order ${order.id.slice(-6).toUpperCase()} has not been accepted in time and needs attention.`,
    data: buildNotificationData({
      app: 'admin',
      orderId: order.id,
      restaurantId: order.restaurantId,
      routeKey: 'admin_access',
      type: 'acceptance_deadline_escalated',
    }),
    title: 'Order awaiting acceptance',
  });
};

const autoCancelOrder = async (order: CustomerOrderRow, result: AcceptanceDeadlineSweepResult) => {
  const cancelledAt = nowIso();

  // FULL refund, forced: 1.0 regardless of the normal status-based rate. Built
  // through the SAME recorded-only path cancelCustomerOrder uses
  // (buildRefundUpdate), so refundAmount == the captured amount and the refund
  // execution semantics are unchanged (recorded into the payment ledger).
  const payment = buildRefundUpdate({
    order,
    refundRate: ACCEPTANCE_FULL_REFUND_RATE,
    reason: 'acceptance_deadline_auto_cancel_full_refund',
  });
  const cancellation = {
    actor: 'system',
    reason: 'acceptance_deadline',
    refundRate: ACCEPTANCE_FULL_REFUND_RATE,
    cancelledAt,
  };
  const timeline = {
    ...(order.timeline ?? {}),
    acceptanceTimedOutAt: cancelledAt,
    cancelledAt,
  };

  // ONE RPC = ONE transaction: the status flip, the refund payload write, and
  // the restaurant miss-count increment are atomic. A partial failure cannot
  // refund without cancelling, nor bump the count without cancelling.
  const { data, error } = await serviceClient.rpc('ebuy_auto_cancel_unaccepted_order', {
    p_order_id: order.id,
    p_payment: payment,
    p_cancellation: cancellation,
    p_timeline: timeline,
  });

  if (error) {
    throw new Error(error.message);
  }

  const cancelled = firstRpcRow<{ cancelled?: boolean }>(data)?.cancelled === true;
  if (!cancelled) {
    // Raced out of 'placed' (a restaurant accepted between the read and the
    // CAS): no cancel, no refund, no missed-count bump.
    result.skipped += 1;
    return;
  }

  result.cancelled += 1;

  // Everything below is best-effort: the money-path unit already committed in
  // the RPC, so a realtime nudge, an event insert, or a push that fails must
  // not undo it or abort the batch.

  // Free any promo-cap slot the now-cancelled (and fully refunded) order held:
  // a single-use code must not be burned because the restaurant failed to
  // accept in time. Runs only on a genuine cancel (cancelled === true above),
  // and is itself best-effort — a release failure never aborts the batch.
  try {
    await releasePromoRedemption(order.id);
  } catch (releaseError) {
    logEdgeEvent('error', 'acceptance auto-cancel promo release failed', {
      error: releaseError instanceof Error ? releaseError.message : String(releaseError),
      orderId: order.id,
    });
  }

  try {
    await broadcastOrderChanged(order.id, { restaurantId: order.restaurantId });
  } catch (broadcastError) {
    logEdgeEvent('error', 'acceptance auto-cancel broadcast failed', {
      error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
      orderId: order.id,
    });
  }

  try {
    await insertDeliveryEvent({
      actorUid: ACCEPTANCE_DEADLINE_SWEEP_ACTOR,
      details: { reason: 'acceptance_deadline', refundRate: ACCEPTANCE_FULL_REFUND_RATE },
      eventType: 'order_auto_cancelled',
      orderId: order.id,
    });
  } catch (eventError) {
    logEdgeEvent('error', 'acceptance auto-cancel event insert failed', {
      error: eventError instanceof Error ? eventError.message : String(eventError),
      orderId: order.id,
    });
  }

  await notifyUsers([order.customerId], {
    title: 'Order cancelled and refunded',
    body: `Order ${order.id.slice(-6).toUpperCase()} was cancelled because the restaurant did not accept it in time. You have been fully refunded.`,
    data: buildNotificationData({
      app: 'customer',
      orderId: order.id,
      routeKey: 'customer_order_detail',
      status: ORDER_STATUS.CANCELLED,
      type: 'order_update',
    }),
  });
  await notifyRestaurantUsers(order.restaurantId, {
    title: 'Order timed out',
    body: `Order ${order.id.slice(-6).toUpperCase()} was cancelled because it was not accepted in time.`,
    data: buildNotificationData({
      app: 'partner',
      orderId: order.id,
      routeKey: 'partner_order_detail',
      status: ORDER_STATUS.CANCELLED,
      type: 'order_update',
    }),
  });
};

/**
 * Runs the sweep. Safe to call as often as you like: an order at deadline-1s is
 * untouched, at the deadline it escalates exactly once, at 2x it cancels +
 * refunds exactly once, and an order that has left 'placed' is never touched.
 */
export const sweepUnacceptedOrders = async (): Promise<AcceptanceDeadlineSweepResult> => {
  const result: AcceptanceDeadlineSweepResult = { cancelled: 0, escalated: 0, skipped: 0 };

  const { acceptanceDeadlineMinutes } = await loadAcceptanceDeadlineConfig();
  const deadlineMs = acceptanceDeadlineMinutes * 60_000;
  const autoCancelMs = deadlineMs * 2;
  const now = Date.now();

  let candidates: CustomerOrderRow[] = [];
  try {
    const { data, error } = await serviceClient
      .from('CustomerOrder')
      .select(CUSTOMER_ORDER_COLUMNS)
      .in('status', PLACED_LIKE_STATUSES)
      .order('createdAt', { ascending: true })
      .limit(ACCEPTANCE_SWEEP_LIMIT);

    if (error) {
      throw new Error(error.message);
    }
    candidates = (data ?? []) as CustomerOrderRow[];
  } catch (error) {
    logEdgeEvent('error', 'acceptance deadline candidate lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  for (const order of candidates) {
    try {
      // Defensive: the query pre-filters, but re-normalize before acting.
      if (normalizeOrderStatus(order.status) !== ORDER_STATUS.PLACED) {
        result.skipped += 1;
        continue;
      }

      // A prepaid order still awaiting payment is not "waiting on the
      // restaurant" - maybeExpireUnpaidOrder owns its fate. Never auto-cancel
      // (and never emit a refund line for) money that was never captured.
      if (!isOrderOperationallyVisible(order)) {
        result.skipped += 1;
        continue;
      }

      // The deadline clock starts when the order entered 'placed'
      // (timeline.placedAt, stamped by both order-creation paths), falling back
      // to createdAt if that is somehow absent.
      const placedAt =
        toSortableTimestamp((order.timeline ?? {}).placedAt) ?? toSortableTimestamp(order.createdAt);
      if (!placedAt) {
        result.skipped += 1;
        continue;
      }

      const age = now - placedAt;
      if (age >= autoCancelMs) {
        await autoCancelOrder(order, result);
      } else if (age >= deadlineMs) {
        await escalateOrder(order, result);
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      // One bad order must not abort the batch.
      result.skipped += 1;
      logEdgeEvent('error', 'acceptance deadline sweep failed for order', {
        error: error instanceof Error ? error.message : String(error),
        orderId: order.id,
      });
    }
  }

  return result;
};
