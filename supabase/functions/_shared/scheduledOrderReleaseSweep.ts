// The scheduled-order release sweep (Task 18 / G2), run by queue-drainer on the
// every-minute pg_cron schedule that already exists — no new cron entry, no new
// secret, no new schedule to keep alive. It sits on the BACKPRESSURE-SAFE side
// of runWithBackpressure (before the throw), exactly like the offer / ping /
// acceptance sweeps: runWithBackpressure THROWS EdgeBackpressureError when it
// sheds, so a sweep sequenced after it would silently stop on busy minutes.
// Scheduled orders must keep releasing during exactly the busy periods that
// cause shedding.
//
// WHAT IT DOES. It flips a paid, waiting 'scheduled' order into 'placed' at
// `scheduledFor − prepTimeMinutes` so the kitchen sees it just in time. The flip
// is a COMPARE-AND-SWAP (updateOrderRecordIfStatus): it lands only if the row is
// STILL 'scheduled'. So a second sweep is a no-op (status is now 'placed', the
// CAS matches nothing), and a customer cancel that raced the release wins
// cleanly (status is 'cancelled', the CAS matches nothing).
//
// THE ACCEPTANCE-DEADLINE CLOCK — the load-bearing correctness point.
// Task 14's acceptance-deadline sweep (acceptanceDeadlineSweep.ts) measures its
// deadline from `timeline.placedAt` (falling back to createdAt) and only ever
// considers orders whose status normalizes to 'placed'. A scheduled order is
// created in status 'scheduled' (which Task 14 never selects) and WITHOUT a
// placedAt (its timeline carries scheduledAt/scheduledFor). At release we stamp
// `timeline.placedAt = the release instant (now)`. That is what makes the
// acceptance clock start at RELEASE, not at scheduling: a just-released order is
// age ~0 and cannot be instantly escalated or auto-cancelled. Stamping createdAt
// instead (or omitting placedAt, so Task 14 falls back to createdAt) would make
// a long-scheduled order instantly overdue the moment it releases — that is the
// exact interaction the release-clock test guards.
//
// Nothing here throws to the caller: queue-drainer's job draining must not fail
// because this sweep had a bad minute, and a single bad order must not abort the
// batch — same discipline as sweepDispatchOffers / sweepUnacceptedOrders.

import {
  buildNotificationData,
  notifyRestaurantUsers,
} from './notifications.ts';
import { logEdgeEvent } from './observability.ts';
import {
  CUSTOMER_ORDER_COLUMNS,
  type CustomerOrderRow,
  insertDeliveryEvent,
  ORDER_STATUS,
  updateOrderRecordIfStatus,
} from './orders.ts';
import { loadScheduledOrderConfig } from './platformSettings.ts';
import { nowIso, toSortableTimestamp } from './rpc/coercion.ts';
import { serviceClient } from './client.ts';

/** The actor recorded on events the release sweep causes. Not a human uid. */
export const SCHEDULED_RELEASE_SWEEP_ACTOR = 'system:scheduled-release-sweep';

/** Bounded per run: due scheduled orders are few; a straggler beyond this cap is
 * picked up next minute (the sweep is idempotent). */
const RELEASE_SWEEP_LIMIT = 100;

export type ScheduledReleaseSweepResult = {
  /** Orders this run flipped scheduled → placed. */
  released: number;
  /** Candidates not yet due, or already flipped out of 'scheduled' by a race. */
  skipped: number;
};

/**
 * Runs the sweep. Safe to call as often as you like: an order before its release
 * moment is untouched, at release it flips exactly once, and a second sweep (or
 * a cancel that raced the flip) is a no-op.
 */
export const sweepScheduledOrderReleases = async (): Promise<ScheduledReleaseSweepResult> => {
  const result: ScheduledReleaseSweepResult = { released: 0, skipped: 0 };

  const { prepTimeMinutes } = await loadScheduledOrderConfig();
  const prepMs = prepTimeMinutes * 60_000;
  const now = Date.now();
  // Release when now >= scheduledFor − prepMs  ⇔  scheduledFor <= now + prepMs.
  const dueBeforeIso = new Date(now + prepMs).toISOString();

  let candidates: CustomerOrderRow[] = [];
  try {
    const { data, error } = await serviceClient
      .from('CustomerOrder')
      .select(CUSTOMER_ORDER_COLUMNS)
      .eq('status', ORDER_STATUS.SCHEDULED)
      .lte('scheduledFor', dueBeforeIso)
      .order('scheduledFor', { ascending: true })
      .limit(RELEASE_SWEEP_LIMIT);

    if (error) {
      throw new Error(error.message);
    }
    candidates = (data ?? []) as CustomerOrderRow[];
  } catch (error) {
    logEdgeEvent('error', 'scheduled release candidate lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  for (const order of candidates) {
    try {
      const scheduledForMs = toSortableTimestamp(order.scheduledFor);
      // Defensive: the query pre-filters, but re-check the due condition so a
      // malformed / not-yet-due row is never released early.
      if (!scheduledForMs || scheduledForMs - prepMs > now) {
        result.skipped += 1;
        continue;
      }

      const releaseAt = nowIso();
      const timeline = {
        ...((order.timeline ?? {}) as Record<string, unknown>),
        // THE CLOCK: acceptance-deadline measures from placedAt; start it NOW so
        // a just-released order is not instantly overdue. Do NOT use createdAt.
        placedAt: releaseAt,
        scheduledReleasedAt: releaseAt,
      };

      // CAS: flip only if still 'scheduled' (the raw stored value). Idempotent —
      // a second sweep, or a cancel that raced this, finds status != 'scheduled'
      // and updates nothing. Broadcasts on a real change internally.
      const applied = await updateOrderRecordIfStatus(order.id, ORDER_STATUS.SCHEDULED, {
        status: ORDER_STATUS.PLACED,
        timeline,
        updatedAt: releaseAt,
      });

      if (!applied) {
        result.skipped += 1;
        continue;
      }

      result.released += 1;

      // Everything below is best-effort: the flip already committed via the CAS,
      // so an event insert or a push that fails must not undo it or abort the batch.
      try {
        await insertDeliveryEvent({
          actorUid: SCHEDULED_RELEASE_SWEEP_ACTOR,
          details: { restaurantId: order.restaurantId, scheduledFor: order.scheduledFor ?? null },
          eventType: 'scheduled_order_released',
          orderId: order.id,
        });
      } catch (eventError) {
        logEdgeEvent('error', 'scheduled release event insert failed', {
          error: eventError instanceof Error ? eventError.message : String(eventError),
          orderId: order.id,
        });
      }

      // notifyRestaurantUsers is best-effort internally (notifySafely) — it will
      // not throw, but wrap it too so nothing downstream of the committed flip
      // can turn into a skipped/errored order.
      try {
        await notifyRestaurantUsers(order.restaurantId, {
          title: 'Scheduled order ready to start',
          body: `Order ${order.id.slice(-6).toUpperCase()} is now in your queue for confirmation.`,
          data: buildNotificationData({
            app: 'partner',
            orderId: order.id,
            routeKey: 'partner_order_detail',
            status: ORDER_STATUS.PLACED,
            type: 'order_update',
          }),
        });
      } catch (notifyError) {
        logEdgeEvent('error', 'scheduled release notify failed', {
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
          orderId: order.id,
        });
      }
    } catch (error) {
      // One bad order must not abort the batch.
      result.skipped += 1;
      logEdgeEvent('error', 'scheduled release sweep failed for order', {
        error: error instanceof Error ? error.message : String(error),
        orderId: order.id,
      });
    }
  }

  return result;
};
