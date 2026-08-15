// Automatic dispatch assignment (Task 9 / D1).
//
// NOTE (2026-08-14): before this task nothing in the RPC surface called into
// this module - see task-9-brief.md for the full history. This is a full
// rewrite, not a wiring-up of what was here: the weighted-random selection
// is gone entirely, a single deterministic score now picks both the
// dispatch owner and the courier in one step, and the DB write is
// claim-guarded (via ebuy_claim_dispatch_assignment, see the migration
// 20260814_dispatch_auto_assignment.sql) so a retry can never double-assign
// or double-increment a rider's load.
//
// Owner vs courier: the sketch this replaced treated "pick a dispatch
// owner" and "pick a courier" as two separate weighted-random draws over
// almost the same pool. In the current data model there is only one kind of
// dispatch account - a UserRole row with role='dispatch', 1:1 with a
// DispatchRiderRecord keyed by the same id - so this rewrite scores that one
// pool once and uses the winner as both the assignment's dispatchOwnerId
// (who sees the order in their queue) and courierId (who delivers it). That
// preserves the sketch's one product-relevant behaviour: a restaurant's own
// self-provisioned riders (UserRole.restaurantId = restaurantId) are tried
// first, falling back to the platform-wide pool (UserRole.restaurantId is
// null) only if the restaurant has none available. Unlike the sketch, the
// fallback pool excludes OTHER restaurants' dedicated riders - only true
// global dispatchers - since assigning one restaurant's dedicated rider to
// a different restaurant's order was never a deliberate product decision,
// just a side effect of the original query not filtering restaurantId at
// all in the fallback branch.

import { serviceClient } from './client.ts';
import { calculateDistanceKm, type GeoPoint } from './deliveryCoverage.ts';
import { DEFAULT_DISPATCH_STATUS, type DispatchRiderRow } from './dispatchRiders.ts';
import type { DispatchWeights } from './dispatchWeights.ts';
import type { UserAccountRow } from './accounts.ts';
import { buildNotificationData, notifyAdmins, notifyUsers } from './notifications.ts';
import {
  getDispatchAssignmentOwnerId,
  insertDeliveryEvent,
  normalizeOrderStatus,
  ORDER_STATUS,
  type CustomerOrderRow,
  type DeliveryAssignmentRow,
} from './orders.ts';
import { broadcastOrderChanged } from './realtime.ts';
import { parseInteger, sanitizeText, unique } from './rpc/coercion.ts';

// ---------------------------------------------------------------------------
// The scorer: pure functions, no I/O. Exported so tests can exercise them
// directly without touching the database.
// ---------------------------------------------------------------------------

export type DispatchScoreCandidate = {
  activeLoad?: number | null;
  id: string;
  latitude?: number | null;
  longitude?: number | null;
};

const hasCoordinates = (
  point: { latitude?: number | null; longitude?: number | null } | null | undefined
): point is GeoPoint =>
  point != null &&
  typeof point.latitude === 'number' && Number.isFinite(point.latitude) &&
  typeof point.longitude === 'number' && Number.isFinite(point.longitude);

// Used only when the origin (restaurant) coordinate is known but a specific
// candidate's is not. Not the delivery-radius concept in
// deliveryCoverage.ts (that's "will we deliver this far", a different
// question) - this is a plain middle-of-the-pool distance estimate so an
// un-synced candidate scores like an average rider, not like the closest
// possible one. A rider's coordinates are only populated once their app
// calls syncDispatchRiderLocation, so treating "no coordinates yet" as
// distanceKm=0 (the previous behaviour) made that the *best* possible
// score, not a neutral one - a newly onboarded, never-synced rider would
// beat every located rider at equal load until they first sync, which
// inverts the distance term exactly for the riders the platform knows
// least about. 6km sits at the midpoint of the platform's own 12km default
// delivery radius (DEFAULT_DELIVERY_RADIUS_KM in deliveryCoverage.ts) -
// a principled "typical" distance rather than an arbitrary one.
export const NEUTRAL_DISTANCE_KM = 6;

/**
 * `score = w_load × activeLoad + w_distance × distanceKm`, lowest wins.
 * `activeLoad` is coerced through `parseInteger` (matching
 * adjustDispatchRiderLoad's own coercion) so a corrupt DB value can't
 * produce `NaN`: a NaN score compares as neither greater than, less than,
 * nor equal to anything, which would make selection depend on iteration
 * order - silently reintroducing the unexplainable ordering this task
 * exists to remove.
 *
 * The distance term is 0 only when the origin itself is unknown (the
 * restaurant has no coordinates) - that affects every candidate in the pool
 * identically, so it can't favour one candidate over another. When the
 * origin is known but a specific candidate's coordinates are not, the
 * candidate gets NEUTRAL_DISTANCE_KM rather than 0, so an un-synced
 * candidate is treated as an average distance away, not the closest
 * possible one.
 */
export const scoreDispatchCandidate = (
  candidate: DispatchScoreCandidate,
  origin: GeoPoint | null,
  weights: DispatchWeights
): number => {
  const activeLoad = Math.max(0, parseInteger(candidate.activeLoad, 0));
  const distanceKm = origin
    ? hasCoordinates(candidate)
      ? calculateDistanceKm(origin, { latitude: candidate.latitude as number, longitude: candidate.longitude as number })
      : NEUTRAL_DISTANCE_KM
    : 0;
  return weights.load * activeLoad + weights.distance * distanceKm;
};

/**
 * Total order over (score, activeLoad, id) - id is unique, so this always
 * resolves a tie deterministically. There is deliberately no random
 * fallback: a random assignment is not explainable to a rider who asks why
 * they didn't get the job, and an id tiebreak can never actually run out.
 */
const compareCandidates = (
  a: DispatchScoreCandidate,
  scoreA: number,
  b: DispatchScoreCandidate,
  scoreB: number
): number => {
  if (scoreA !== scoreB) {
    return scoreA - scoreB;
  }

  const loadDelta = Math.max(0, parseInteger(a.activeLoad, 0)) - Math.max(0, parseInteger(b.activeLoad, 0));
  if (loadDelta !== 0) {
    return loadDelta;
  }

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
};

/**
 * Deterministic selection over a candidate pool: same inputs always produce
 * the same winner, any number of times. `null` for an empty pool.
 */
export const selectLowestScoreCandidate = <T extends DispatchScoreCandidate>(
  candidates: T[],
  origin: GeoPoint | null,
  weights: DispatchWeights
): T | null => {
  let best: T | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    const score = scoreDispatchCandidate(candidate, origin, weights);
    if (best === null || compareCandidates(candidate, score, best, bestScore) < 0) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
};

// ---------------------------------------------------------------------------
// Candidate loading (DB-touching).
// ---------------------------------------------------------------------------

type DispatchCandidate = DispatchScoreCandidate & { rider: DispatchRiderRow };

// Only accountDisabled is read here, so the parameter is typed to exactly
// what the 'uid,accountDisabled' select below returns (Pick<...>) rather
// than the full UserAccountRow - the original sketch typed this as
// UserAccountRow while only ever passing the narrower Pick, which is
// TS2345 (one of the six pre-existing dispatchSelection.ts errors this
// rewrite fixes).
const isDispatcherEligible = (
  account: Pick<UserAccountRow, 'accountDisabled'> | null,
  rider: DispatchRiderRow | null
) => {
  if (!account || account.accountDisabled === true) {
    return false;
  }

  if (!rider) {
    return false;
  }

  const riderStatus = sanitizeText(rider.status, DEFAULT_DISPATCH_STATUS);
  return riderStatus !== 'Offline';
};

/**
 * `restaurantId === null` loads the true global pool (UserRole.restaurantId
 * is null) - see the module header for why this differs from the sketch.
 */
const loadDispatchCandidates = async (restaurantId: string | null): Promise<DispatchCandidate[]> => {
  const roleQuery = serviceClient.from('UserRole').select('userId,restaurantId').eq('role', 'dispatch');
  const { data: roleRows, error: roleError } = restaurantId
    ? await roleQuery.eq('restaurantId', restaurantId)
    : await roleQuery.is('restaurantId', null);

  if (roleError) {
    throw new Error(roleError.message);
  }

  const userIds = unique(((roleRows ?? []) as { userId: string }[]).map((row) => row.userId));
  if (userIds.length === 0) {
    return [];
  }

  const [{ data: accounts, error: accountError }, { data: riders, error: riderError }] = await Promise.all([
    serviceClient.from('UserAccount').select('uid,accountDisabled').in('uid', userIds),
    serviceClient
      .from('DispatchRiderRecord')
      .select('id,displayName,status,activeLoad,latitude,longitude')
      .in('id', userIds),
  ]);

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (riderError) {
    throw new Error(riderError.message);
  }

  const accountsById = new Map(((accounts ?? []) as Pick<UserAccountRow, 'uid' | 'accountDisabled'>[]).map((row) => [
    row.uid,
    row,
  ]));
  const ridersById = new Map(((riders ?? []) as DispatchRiderRow[]).map((row) => [row.id, row]));

  const candidates: DispatchCandidate[] = [];
  for (const userId of userIds) {
    const account = accountsById.get(userId) ?? null;
    const rider = ridersById.get(userId) ?? null;

    if (!isDispatcherEligible(account, rider)) {
      continue;
    }

    candidates.push({
      activeLoad: rider?.activeLoad ?? 0,
      id: userId,
      latitude: rider?.latitude ?? null,
      longitude: rider?.longitude ?? null,
      rider: rider as DispatchRiderRow,
    });
  }

  return candidates;
};

const loadRestaurantCoordinate = async (restaurantId: string): Promise<GeoPoint | null> => {
  const { data, error } = await serviceClient
    .from('RestaurantRecord')
    .select('latitude,longitude')
    .eq('id', restaurantId)
    .maybeSingle<{ latitude?: number | null; longitude?: number | null }>();

  if (error) {
    throw new Error(error.message);
  }

  return hasCoordinates(data ?? null)
    ? { latitude: (data as { latitude: number }).latitude, longitude: (data as { longitude: number }).longitude }
    : null;
};

// ---------------------------------------------------------------------------
// The atomic claim (DB-touching). See ebuy_claim_dispatch_assignment in
// 20260814_dispatch_auto_assignment.sql for why this is one RPC call rather
// than a read-then-write pair.
// ---------------------------------------------------------------------------

const claimDispatchAssignment = async (
  orderId: string,
  courierId: string,
  courierName: string,
  dispatchOwnerId: string
): Promise<boolean> => {
  const { data, error } = await serviceClient.rpc('ebuy_claim_dispatch_assignment', {
    p_courier_id: courierId,
    p_courier_name: courierName,
    p_dispatch_owner_id: dispatchOwnerId,
    p_order_id: orderId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = (Array.isArray(data) ? data[0] : data) as { claimed?: boolean } | null | undefined;
  return row?.claimed === true;
};

/**
 * The other end of the assignment lifecycle: releases a claimed rider's
 * load back when their order reaches a state where they are no longer
 * carrying it (delivered, failed, cancelled, or the restaurant rejects
 * after an auto-assign already happened). Symmetric with
 * claimDispatchAssignment - guarded by
 * ebuy_release_dispatch_assignment_load's `loadReleasedAt is null` check so
 * two near-simultaneous calls for the same order (the same double-fire
 * shape assignment itself has to guard against) release the load exactly
 * once, never twice.
 *
 * Keyed on the order alone (review round 4). The rider whose load is
 * decremented is whoever the assignment row names at the moment the release
 * commits, NOT whoever the caller believed it named: every caller reads its
 * order bundle once at request start and only gets here several awaits
 * later, so a courier id taken from that bundle is by construction a stale
 * read. Passing one meant a release landing just after a manual
 * reassignment matched zero rows (`where "courierId" = <the old rider>`)
 * and silently decremented nothing, stranding the new rider's claim on an
 * order that would never transition again.
 *
 * For the same reason it is safe - and required - to call this
 * unconditionally on a terminal transition rather than gating on the
 * caller's snapshot having a courier: an order the snapshot showed as
 * unassigned may have been claimed by automatic assignment in between, and
 * a release skipped on that basis leaks the claim permanently. With no live
 * claim the statement matches no rows and returns false, one cheap indexed
 * no-op.
 */
export const releaseDispatchAssignmentLoad = async (orderId: string): Promise<boolean> => {
  const { data, error } = await serviceClient.rpc('ebuy_release_dispatch_assignment_load', {
    p_order_id: orderId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = (Array.isArray(data) ? data[0] : data) as { released?: boolean } | null | undefined;
  return row?.released === true;
};

export type DispatchReassignmentResult = {
  /** Normalized committed status the swap was evaluated against; null if the order is gone. */
  orderStatus: string | null;
  /** The courier the row named before the swap, straight from the locked row. */
  previousCourierId: string | null;
  reassigned: boolean;
};

/**
 * Manual (re)assignment of an order's courier, as one compare-and-swap.
 *
 * The row update, the previous courier's decrement and the new courier's
 * increment all happen inside ebuy_reassign_dispatch_assignment_courier
 * (see 20260815_dispatch_reassignment_cas.sql), conditioned on the order's
 * *currently committed* status and on the assignment's claim not having
 * already been released - not on the bundle the handler read at request
 * start. `reassigned: false` means the swap did not happen and nothing was
 * written: no row change, no decrement, no increment. Callers must surface
 * that as a failed precondition rather than reporting success, because
 * every downstream side effect (the event log, the "rider assigned" pushes,
 * the response body) would otherwise describe an assignment that does not
 * exist.
 */
export const reassignDispatchAssignmentCourier = async (
  orderId: string,
  courierId: string,
  courierName: string,
  dispatchId: string
): Promise<DispatchReassignmentResult> => {
  const { data, error } = await serviceClient.rpc('ebuy_reassign_dispatch_assignment_courier', {
    p_courier_id: courierId,
    p_courier_name: courierName,
    p_dispatch_id: dispatchId,
    p_order_id: orderId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { orderStatus?: string | null; previousCourierId?: string | null; reassigned?: boolean }
    | null
    | undefined;

  return {
    orderStatus: sanitizeText(row?.orderStatus) || null,
    previousCourierId: sanitizeText(row?.previousCourierId) || null,
    reassigned: row?.reassigned === true,
  };
};

const recordDispatchPoolEmpty = async (order: CustomerOrderRow, actorUid: string) => {
  const { data: existingPoolEvent, error: poolEventError } = await serviceClient
    .from('DeliveryEvent')
    .select('id')
    .eq('orderId', order.id)
    .eq('eventType', 'dispatch_pool_empty')
    .maybeSingle<{ id: string }>();

  if (poolEventError) {
    throw new Error(poolEventError.message);
  }

  // Already recorded on an earlier attempt for this order - the retry on
  // the next status change should keep trying to assign, but should not
  // keep paging admins about the same still-empty pool.
  if (existingPoolEvent) {
    return;
  }

  await insertDeliveryEvent({
    actorUid,
    details: {
      restaurantId: order.restaurantId,
    },
    eventType: 'dispatch_pool_empty',
    orderId: order.id,
  });

  await notifyAdmins({
    body: `Order ${order.id.slice(-6).toUpperCase()} is waiting for a dispatch pool assignment.`,
    data: buildNotificationData({
      app: 'admin',
      orderId: order.id,
      restaurantId: order.restaurantId,
      routeKey: 'admin_access',
      type: 'dispatch_pool_empty',
    }),
    title: 'Dispatch pool empty',
  });
};

// ---------------------------------------------------------------------------
// Orchestration: the one function the RPC domains call.
// ---------------------------------------------------------------------------

const AUTO_DISPATCH_ELIGIBLE_STATUSES: readonly string[] = [
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
];

export type AutomaticDispatchOutcome =
  | { outcome: 'assigned'; courierId: string; ownerId: string }
  | { outcome: 'already_assigned'; ownerId: string | null }
  | { outcome: 'pool_empty' }
  | { outcome: 'skipped' };

/**
 * Runs automatic dispatch assignment for an order that just transitioned
 * into (or through) accepted/preparing/ready_for_pickup. Safe to call on
 * every one of those transitions - it is a deliberate retry point for an
 * order that hit an empty pool earlier, and a no-op (via the DB-level
 * claim guard, not just the `assignment` snapshot passed in) if a courier
 * is already attached.
 *
 * `loadWeights` is injected (rather than this module importing
 * platformSettings.ts's loadDispatchWeights itself) for two reasons: it
 * keeps the module graph a DAG - platformSettings.ts already imports
 * dispatchWeights.ts, which this module also imports for the DispatchWeights
 * type, so a static import the other way would be a cycle - and it makes
 * this orchestration function trivially testable with a fixed weights
 * object instead of a live PlatformSettings row.
 *
 * Never throws for "no eligible courier" - that is the pool_empty outcome,
 * not a failure. Callers should still treat unexpected errors (a thrown
 * Error from a DB call) as non-fatal to whatever status transition
 * triggered this: a selection failure must never roll back an order that
 * was already accepted.
 */
export const runAutomaticDispatchAssignment = async (
  order: CustomerOrderRow,
  assignment: DeliveryAssignmentRow | null,
  actorUid: string,
  targetStatus: string,
  loadWeights: () => Promise<DispatchWeights>
): Promise<AutomaticDispatchOutcome> => {
  const currentStatus = normalizeOrderStatus(targetStatus);
  if (!AUTO_DISPATCH_ELIGIBLE_STATUSES.includes(currentStatus)) {
    return { outcome: 'skipped' };
  }

  if (sanitizeText(order.fulfillmentType, 'delivery') !== 'delivery') {
    return { outcome: 'skipped' };
  }

  if (sanitizeText(assignment?.courierId)) {
    return { outcome: 'already_assigned', ownerId: getDispatchAssignmentOwnerId(assignment) || null };
  }

  const [restaurantCoordinate, restaurantScopedCandidates] = await Promise.all([
    loadRestaurantCoordinate(order.restaurantId),
    loadDispatchCandidates(order.restaurantId),
  ]);

  let restaurantScoped = true;
  let candidates = restaurantScopedCandidates;
  if (candidates.length === 0) {
    restaurantScoped = false;
    candidates = await loadDispatchCandidates(null);
  }

  const weights = await loadWeights();
  const winner = selectLowestScoreCandidate(candidates, restaurantCoordinate, weights);

  if (!winner) {
    await recordDispatchPoolEmpty(order, actorUid);
    return { outcome: 'pool_empty' };
  }

  const courierName = sanitizeText(winner.rider.displayName, `Rider ${winner.id.slice(-4)}`);
  const claimed = await claimDispatchAssignment(order.id, winner.id, courierName, winner.id);

  if (!claimed) {
    // Either a concurrent call (another retry, or a manual override landing
    // at the same moment) already claimed this order, or - since review
    // round 4 - the order left the auto-eligible window while this call was
    // scoring the pool (a cancel or reject committing in between). Both are
    // "there is nothing for this caller to do", not failures, and both must
    // avoid logging a second dispatch_assigned event, notifying a rider who
    // was not assigned, or incrementing load a second time. No production
    // caller branches on the outcome value, so the two share one label
    // rather than warranting a return-type change to the SQL function.
    return { outcome: 'already_assigned', ownerId: null };
  }

  await insertDeliveryEvent({
    actorUid,
    details: {
      courierId: winner.id,
      courierName,
      restaurantScoped,
    },
    eventType: 'dispatch_assigned',
    orderId: order.id,
  });

  await notifyUsers([winner.id], {
    body: `Order ${order.id.slice(-6).toUpperCase()} is now in your queue.`,
    data: buildNotificationData({
      app: 'dispatch',
      orderId: order.id,
      routeKey: 'dispatch_delivery_detail',
      type: 'dispatch_assignment',
    }),
    title: 'New dispatch order',
  });

  await broadcastOrderChanged(order.id);

  return { courierId: winner.id, outcome: 'assigned', ownerId: winner.id };
};
