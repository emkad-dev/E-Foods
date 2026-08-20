// Delivery offers (Task 10 / D2): the thin, DB-touching layer over the four
// SQL functions in 20260816_dispatch_delivery_offers.sql, plus the two reads
// the orchestration and the dispatch app need.
//
// This module deliberately holds NO policy. Every guard - who may accept, what
// counts as exhausted, whether an offer is still live, whether a claim is
// allowed to land - is in SQL, under the CustomerOrder row lock, for the reason
// Task 9's four review rounds established: a guard in TypeScript is a guard on
// a snapshot, and two Deno isolates can both pass the same snapshot check.
// What lives here is argument marshalling, result shaping, and the exclusion
// read.
//
// It also imports nothing from dispatchSelection.ts, on purpose: selection
// imports THIS module (for the exclusion read and the offer call), and the
// re-offer helper that closes the loop lives on the selection side. Keeping
// the dependency one-directional keeps the module graph a DAG.

import { serviceClient } from './client.ts';
import { sanitizeText, unique } from './rpc/coercion.ts';

/**
 * How long a rider has to answer. The brief's 45 seconds, in one place: it is
 * passed to ebuy_offer_dispatch_assignment as `p_ttl_seconds` rather than
 * being computed here, so `respondsBy` is derived from the database's own
 * `now()` under the same lock that writes the row - never from an edge
 * function's clock, which can differ.
 */
export const DISPATCH_OFFER_TTL_SECONDS = 45;

/**
 * After this many offers for one order, stop offering and fall back to the
 * manual queue. Enforced in SQL (`v_total >= p_max_offers`) as well as read
 * here; the TypeScript check is a cheap early exit that saves scoring a pool
 * we are about to be refused for, not the authority.
 */
export const MAX_DISPATCH_OFFERS = 3;

/** How many due offers one queue-drainer sweep flips, and how many stragglers it re-offers. */
export const DISPATCH_OFFER_SWEEP_LIMIT = 50;

export const DISPATCH_OFFER_STATUS = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  PENDING: 'pending',
  SUPERSEDED: 'superseded',
} as const;

export type DispatchOfferRow = {
  courierId: string;
  id: string;
  offeredAt?: string | null;
  orderId: string;
  respondedAt?: string | null;
  respondsBy: string;
  sequence?: number | null;
  status: string;
};

export type OfferCreationResult = {
  offerId: string | null;
  offered: boolean;
  reason: string;
  sequence: number | null;
};

export type OfferResponseResult = {
  ok: boolean;
  orderId: string | null;
  reason: string;
};

export type ExpiredOfferRow = {
  courierId: string;
  offerId: string;
  orderId: string;
};

const firstRow = <T>(data: unknown): T | null => {
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as T | null;
};

/**
 * Creates a `pending` offer for (order, courier), or explains why it could
 * not. Never throws for a refusal - `offered: false` plus a machine-readable
 * `reason` is the normal shape, because automatic selection runs on a
 * best-effort path behind the status transition that triggered it and must
 * never unwind it.
 */
export const offerDispatchAssignment = async (
  orderId: string,
  courierId: string
): Promise<OfferCreationResult> => {
  const { data, error } = await serviceClient.rpc('ebuy_offer_dispatch_assignment', {
    p_courier_id: courierId,
    p_max_offers: MAX_DISPATCH_OFFERS,
    p_order_id: orderId,
    p_ttl_seconds: DISPATCH_OFFER_TTL_SECONDS,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = firstRow<{ offerId?: string | null; offered?: boolean; reason?: string | null; sequence?: number | null }>(
    data
  );

  return {
    offerId: sanitizeText(row?.offerId) || null,
    offered: row?.offered === true,
    reason: sanitizeText(row?.reason, 'unknown'),
    sequence: typeof row?.sequence === 'number' ? row.sequence : null,
  };
};

/**
 * The one path that creates a capacity claim in the offer model.
 * ebuy_accept_dispatch_offer calls ebuy_claim_dispatch_assignment - unchanged
 * from Task 9 - so the single `activeLoad` increment in this system still has
 * exactly one implementation and one guard.
 *
 * `courierId` is the authenticated caller's uid, not a request field: the SQL
 * matches on it, so a rider can neither accept another rider's offer nor probe
 * for offer ids that are not theirs (a foreign id is `offer_not_found`, the
 * same answer as a nonexistent one).
 */
export const acceptDispatchOffer = async (
  offerId: string,
  courierId: string,
  courierName: string
): Promise<OfferResponseResult> => {
  const { data, error } = await serviceClient.rpc('ebuy_accept_dispatch_offer', {
    p_courier_id: courierId,
    p_courier_name: courierName,
    p_offer_id: offerId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = firstRow<{ accepted?: boolean; orderId?: string | null; reason?: string | null }>(data);

  return {
    ok: row?.accepted === true,
    orderId: sanitizeText(row?.orderId) || null,
    reason: sanitizeText(row?.reason, 'unknown'),
  };
};

/** Marks the rider's own pending offer declined. Touches no counter. */
export const declineDispatchOffer = async (
  offerId: string,
  courierId: string
): Promise<OfferResponseResult> => {
  const { data, error } = await serviceClient.rpc('ebuy_decline_dispatch_offer', {
    p_courier_id: courierId,
    p_offer_id: offerId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = firstRow<{ declined?: boolean; orderId?: string | null; reason?: string | null }>(data);

  return {
    ok: row?.declined === true,
    orderId: sanitizeText(row?.orderId) || null,
    reason: sanitizeText(row?.reason, 'unknown'),
  };
};

/**
 * Flips every offer whose deadline has passed to `expired`, returning only
 * the rows this call actually changed. Idempotent - see the function's own
 * comment in the migration for the four separate reasons.
 */
export const expireDispatchOffers = async (
  limit = DISPATCH_OFFER_SWEEP_LIMIT
): Promise<ExpiredOfferRow[]> => {
  const { data, error } = await serviceClient.rpc('ebuy_expire_dispatch_offers', {
    p_limit: limit,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as ExpiredOfferRow[]).filter((row) => Boolean(sanitizeText(row?.orderId)));
};

/**
 * Orders that have been offered before, have no live offer, have no courier,
 * and have not exhausted their offer budget - i.e. the orders the sweep should
 * re-offer.
 *
 * Driven off the ORDER's state rather than off what the expiry pass just
 * returned, so a drainer that dies between the two passes loses nothing: the
 * straggler is simply picked up next minute. See the migration.
 */
export const listDispatchReofferCandidates = async (
  limit = DISPATCH_OFFER_SWEEP_LIMIT
): Promise<string[]> => {
  const { data, error } = await serviceClient.rpc('ebuy_list_dispatch_reoffer_candidates', {
    p_limit: limit,
    p_max_offers: MAX_DISPATCH_OFFERS,
  });

  if (error) {
    throw new Error(error.message);
  }

  return unique(((data ?? []) as { orderId?: string | null }[]).map((row) => sanitizeText(row?.orderId)));
};

export type OrderOfferSummary = {
  /** THE EXCLUSION SET: every courier who has seen this order, in any state. */
  courierIds: string[];
  /** How many offers are still live. Non-zero means somebody has the clock. */
  pendingCount: number;
  /** Total offers made, against which MAX_DISPATCH_OFFERS is measured. */
  total: number;
};

/**
 * One read that answers all three questions selection needs before it scores
 * a pool: who is excluded, is an offer still live, and have we hit the cap.
 *
 * Statuses are read, not just courier ids, because "no candidate left after
 * exclusion" means two completely different things depending on whether an
 * offer is outstanding. With a single rider on the platform, the rider we
 * just offered to is themselves excluded, so the filtered pool is empty while
 * the order is being perfectly well handled - concluding exhaustion there
 * would page an admin about an order a rider is actively looking at.
 *
 * This read is only half the exclusion mechanism, and knowingly the weaker
 * half - it is a snapshot, so two concurrent re-offers could compute the same
 * "next best" rider from it. The half that actually holds is the
 * `("orderId", "courierId")` unique index: the second insert raises
 * unique_violation, which ebuy_offer_dispatch_assignment converts into an
 * `already_offered` refusal. Same division of labour as everywhere else in
 * this subsystem - the filter is an optimisation, the constraint is the truth.
 */
export const loadOrderOfferSummary = async (orderId: string): Promise<OrderOfferSummary> => {
  const { data, error } = await serviceClient
    .from('DeliveryOffer')
    .select('courierId,status,respondsBy')
    .eq('orderId', orderId);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as { courierId?: string | null; respondsBy?: string | null; status?: string | null }[];

  // `pendingCount` counts offers that are BOTH pending and still inside their
  // window. Counting `status = 'pending'` alone made the migration's lazy
  // expiry unreachable: selection would see a lapsed-but-not-yet-swept offer,
  // return `offer_outstanding` before ever calling
  // ebuy_offer_dispatch_assignment, and so never reach the `respondsBy <= now`
  // UPDATE that exists precisely to stop a dead offer blocking the next one.
  // The order would then wait up to a full sweep interval for a re-offer -
  // exactly the delay the lazy expiry was written to avoid.
  //
  // Reading `respondsBy` here uses the edge function's clock, which is only
  // safe because this is a HINT that decides whether to attempt an offer.
  // Whether an offer may actually be created is re-decided in SQL under the
  // order row lock against the database clock, and a wrong guess here costs
  // one refused call and nothing else.
  const now = Date.now();
  const stillLive = (row: { respondsBy?: string | null; status?: string | null }) => {
    if (sanitizeText(row?.status) !== DISPATCH_OFFER_STATUS.PENDING) {
      return false;
    }
    const deadline = Date.parse(sanitizeText(row?.respondsBy));
    return !Number.isFinite(deadline) || deadline > now;
  };

  return {
    courierIds: unique(rows.map((row) => sanitizeText(row?.courierId))),
    pendingCount: rows.filter(stillLive).length,
    total: rows.length,
  };
};

/**
 * Closes out any still-live offer for an order that has just been claimed by
 * another route - today, a dispatcher's manual assignment.
 *
 * Purely cosmetic to the ledger and deliberately so: it moves rows from
 * `pending` to `superseded` and touches no counter, because a pending offer
 * never carried a claim. Without it, a rider who was mid-decision when an
 * admin assigned the order by hand keeps a live-looking countdown for a
 * delivery that is already someone else's; accepting it is correctly refused
 * (ebuy_claim_dispatch_assignment finds a courier already set), but only
 * after they have watched the clock and tapped Accept.
 *
 * Never throws: it is called after the assignment has already committed, and
 * a tidy-up failure must not fail the assignment. Idempotent - the predicate
 * is `status = 'pending'`, so a second call matches nothing.
 */
export const supersedePendingOffersForOrder = async (orderId: string): Promise<void> => {
  const { error } = await serviceClient
    .from('DeliveryOffer')
    .update({ respondedAt: new Date().toISOString(), status: DISPATCH_OFFER_STATUS.SUPERSEDED })
    .eq('orderId', orderId)
    .eq('status', DISPATCH_OFFER_STATUS.PENDING);

  if (error) {
    throw new Error(error.message);
  }
};

/** The rider's live offer inbox, newest first. Powers dispatchGetDeliveryQueue's `offers` array. */
export const loadPendingOffersForCourier = async (courierId: string): Promise<DispatchOfferRow[]> => {
  const { data, error } = await serviceClient
    .from('DeliveryOffer')
    .select('id,orderId,courierId,status,offeredAt,respondsBy,respondedAt,sequence')
    .eq('courierId', courierId)
    .eq('status', DISPATCH_OFFER_STATUS.PENDING)
    .order('offeredAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  // Expiry is swept every minute, so a row can legitimately still read
  // `pending` for up to a minute past its deadline. Filtering here keeps a
  // dead offer off the rider's screen in that window without pretending the
  // client-side clock is authoritative about anything else: accepting one is
  // refused by ebuy_accept_dispatch_offer's own deadline check regardless.
  const now = Date.now();
  return ((data ?? []) as DispatchOfferRow[]).filter((row) => {
    const deadline = Date.parse(sanitizeText(row.respondsBy));
    return !Number.isFinite(deadline) || deadline > now;
  });
};

export const buildDispatchOfferResponse = (offer: DispatchOfferRow) => ({
  courierId: offer.courierId,
  id: offer.id,
  offeredAt: offer.offeredAt ?? null,
  orderId: offer.orderId,
  respondedAt: offer.respondedAt ?? null,
  respondsBy: offer.respondsBy,
  sequence: offer.sequence ?? null,
  status: offer.status,
});
