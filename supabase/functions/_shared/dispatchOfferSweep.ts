// The delivery-offer expiry sweep (Task 10 / D2), run by queue-drainer on the
// every-minute pg_cron schedule that already exists
// (20260624_queue_drainer_schedule.sql posts {"queue":"all"} - no new cron
// entry, no new secret, no new schedule to keep alive).
//
// Lives in its own module rather than in dispatchOffers.ts or
// dispatchSelection.ts to keep the import graph a DAG: dispatchSelection
// imports dispatchOffers, and this imports both. Putting the sweep in
// dispatchOffers would have made that pair cyclic.
//
// TWO INDEPENDENT PASSES, AND WHY THEY ARE INDEPENDENT
// ---------------------------------------------------
// Pass 1 flips every offer whose 45s deadline has passed to `expired`.
// Pass 2 asks the database which ORDERS currently deserve a re-offer, and
// re-offers them.
//
// Pass 2 deliberately does NOT consume pass 1's return value. The obvious
// design - "re-offer each order whose offer I just expired" - silently loses
// work: if this function dies between the expiry UPDATE committing and the
// re-offer being issued (a 5s pg_net timeout, an isolate eviction, a deploy),
// that order now has no pending offer and nothing will ever create one again,
// because the next sweep's expiry pass finds nothing due. Driving pass 2 off
// the ORDER's own state makes the two passes independent and the whole sweep
// crash-safe: a straggler is simply picked up on the next minute's run.
//
// IDEMPOTENCE, on every axis:
//   * pass 1's predicate is `status = 'pending'`, so an offer already expired
//     by a previous sweep - or by ebuy_offer_dispatch_assignment's /
//     ebuy_accept_dispatch_offer's lazy expiry - matches nothing;
//   * `for update skip locked` means two concurrent drainer invocations take
//     disjoint batches rather than blocking or double-flipping;
//   * pass 2's re-offer goes through the ordinary selection path, whose
//     `pending > 0` check and whose SQL-side `v_pending > 0` refusal make a
//     duplicate offer impossible;
//   * neither pass touches activeLoad. Expiry is not a claim and never was,
//     so there is no counter for a repeated sweep to corrupt. This is the
//     property the claim-on-accept decision buys: the cron job cannot
//     possibly unbalance the ledger, because it cannot reach it.
//
// Nothing here throws to the caller. queue-drainer's own job draining must
// not fail because dispatch offers had a bad minute, and vice versa.

import { expireDispatchOffers, listDispatchReofferCandidates } from './dispatchOffers.ts';
import { reofferDispatchOrder } from './dispatchSelection.ts';
import { logEdgeEvent } from './observability.ts';
import { loadDispatchWeights } from './platformSettings.ts';

/** The actor recorded on events the sweep causes. Not a real uid - there is no human here. */
export const DISPATCH_OFFER_SWEEP_ACTOR = 'system:dispatch-offer-sweep';

export type DispatchOfferSweepResult = {
  /** Offers this run actually flipped to `expired` (not offers that were already expired). */
  expired: number;
  /** Orders this run created a fresh offer for. */
  reoffered: number;
  /** Orders that were candidates but produced no new offer (exhausted, empty pool, raced). */
  skipped: number;
};

/**
 * Runs both passes. Safe to call as often as you like: calling it a thousand
 * times over the same data expires each offer exactly once and never creates a
 * duplicate offer.
 */
export const sweepDispatchOffers = async (): Promise<DispatchOfferSweepResult> => {
  const result: DispatchOfferSweepResult = { expired: 0, reoffered: 0, skipped: 0 };

  // Pass 1 - expire.
  try {
    const expiredRows = await expireDispatchOffers();
    result.expired = expiredRows.length;
  } catch (error) {
    logEdgeEvent('error', 'dispatch offer expiry pass failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Deliberately falls through to pass 2 rather than returning: the
    // re-offer pass reads the orders' own state and does not depend on this
    // pass having succeeded. An order left pending-but-overdue by a failed
    // expiry is simply not yet a candidate, which is correct.
  }

  // Pass 2 - re-offer, driven off order state.
  let candidates: string[] = [];
  try {
    candidates = await listDispatchReofferCandidates();
  } catch (error) {
    logEdgeEvent('error', 'dispatch re-offer candidate lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  for (const orderId of candidates) {
    try {
      const outcome = await reofferDispatchOrder(orderId, DISPATCH_OFFER_SWEEP_ACTOR, loadDispatchWeights);
      if (outcome.outcome === 'offered') {
        result.reoffered += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      // One bad order must not abort the batch.
      result.skipped += 1;
      logEdgeEvent('error', 'dispatch re-offer failed', {
        error: error instanceof Error ? error.message : String(error),
        orderId,
      });
    }
  }

  return result;
};
