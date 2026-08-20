// Tests for automatic dispatch assignment (Task 9 / D1): the deterministic
// scorer as a pure function, plus an idempotency test against the real
// runAutomaticDispatchAssignment orchestration with a fake serviceClient.
//
// _shared/client.ts throws at module scope without SUPABASE_URL /
// SERVICE_ROLE_KEY set first (a normal top-level import is hoisted and
// evaluated before any test body runs), so the two env vars are set here,
// then the module under test is imported dynamically - the same pattern
// domains/adminSetRestaurantPublished.test.ts uses and explains in its own
// header comment. dispatchSelection.ts type-checks clean against the
// committed baseline (verified as part of this task - see task-9-report.md),
// so unlike that other test file this one runs in package.json's first,
// type-checked `deno test` invocation.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const {
  NEUTRAL_DISTANCE_KM,
  releaseDispatchAssignmentLoad,
  runAutomaticDispatchAssignment,
  scoreDispatchCandidate,
  selectLowestScoreCandidate,
} = await import('./dispatchSelection.ts');
const { serviceClient } = await import('./client.ts');
const { DEFAULT_DISPATCH_WEIGHTS } = await import('./dispatchWeights.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// ---------------------------------------------------------------------------
// The scorer: pure functions, no mocks needed.
// ---------------------------------------------------------------------------

const origin = { latitude: 6.5244, longitude: 3.3792 }; // Lagos

// Review finding (round 2): degrading a missing candidate coordinate to
// distanceKm=0 made "no location on file yet" the *best possible* score,
// not a neutral one - a newly onboarded rider (coordinates are only
// populated once their app calls syncDispatchRiderLocation) would beat
// every located rider at equal load until they first sync. The fix
// distinguishes the two "missing coordinates" cases: the origin (restaurant)
// being unknown affects every candidate identically, so it stays 0; a
// specific candidate lacking coordinates while the origin IS known gets
// NEUTRAL_DISTANCE_KM instead - treated as an average distance away, not
// the closest possible one.
Deno.test('scoreDispatchCandidate: a candidate missing coordinates gets a neutral distance, not a free win', () => {
  const noCandidateCoords = scoreDispatchCandidate(
    { activeLoad: 3, id: 'a', latitude: null, longitude: null },
    origin,
    DEFAULT_DISPATCH_WEIGHTS
  );
  expectEqual(
    noCandidateCoords,
    DEFAULT_DISPATCH_WEIGHTS.load * 3 + DEFAULT_DISPATCH_WEIGHTS.distance * NEUTRAL_DISTANCE_KM,
    'no candidate coordinates (origin known): distance term is the neutral default, not 0'
  );
});

Deno.test('scoreDispatchCandidate: an unknown origin degrades every candidate to load-only uniformly', () => {
  const noOriginCoords = scoreDispatchCandidate(
    { activeLoad: 3, id: 'a', latitude: 6.6, longitude: 3.4 },
    null,
    DEFAULT_DISPATCH_WEIGHTS
  );
  expectEqual(
    noOriginCoords,
    DEFAULT_DISPATCH_WEIGHTS.load * 3,
    'no origin coordinates: distance term is 0 - fair, since it affects every candidate equally'
  );
});

Deno.test('selectLowestScoreCandidate: an un-synced candidate no longer beats a truly nearby located candidate for free', () => {
  const unsynced = { activeLoad: 0, id: 'unsynced', latitude: null, longitude: null };
  const veryClose = { activeLoad: 0, id: 'very-close', latitude: 6.5245, longitude: 3.3793 }; // ~15m from origin

  const winner = selectLowestScoreCandidate([unsynced, veryClose], origin, DEFAULT_DISPATCH_WEIGHTS);
  expectEqual(
    winner?.id,
    'very-close',
    'a genuinely nearby located candidate beats an un-synced one - the previous 0-distance freebie would have picked "unsynced" instead'
  );
});

// Review finding (round 2): activeLoad comes straight from the database with
// no coercion, unlike the admin-controlled weights (which parseDispatchWeights
// already bounds-checks). A corrupt value there produces a NaN score, and
// NaN compares as neither greater than, less than, nor equal to anything -
// selection would then depend on iteration order, silently reintroducing the
// unexplainable ordering this task exists to remove.
Deno.test('scoreDispatchCandidate: a non-numeric activeLoad is coerced rather than propagating NaN', () => {
  const score = scoreDispatchCandidate(
    { activeLoad: Number.NaN, id: 'a', latitude: null, longitude: null },
    null,
    DEFAULT_DISPATCH_WEIGHTS
  );
  expectEqual(score, 0, 'a NaN activeLoad is coerced to 0 (parseInteger fallback), not propagated as NaN');
});

Deno.test('selectLowestScoreCandidate: a corrupt activeLoad does not make selection input-order-dependent', () => {
  const candidates = [
    { activeLoad: Number.NaN, id: 'corrupt', latitude: null, longitude: null },
    { activeLoad: 2, id: 'normal', latitude: null, longitude: null },
  ];

  const forward = selectLowestScoreCandidate(candidates, null, DEFAULT_DISPATCH_WEIGHTS)?.id;
  const reversed = selectLowestScoreCandidate([...candidates].reverse(), null, DEFAULT_DISPATCH_WEIGHTS)?.id;

  expectEqual(forward, reversed, 'the winner does not depend on input order even with a corrupt activeLoad value');
  expectEqual(forward, 'corrupt', 'NaN coerces to 0, the lowest possible load, so it deterministically (if surprisingly) wins');
});

Deno.test('selectLowestScoreCandidate: nearest wins at equal load', () => {
  const near = { activeLoad: 2, id: 'near', latitude: 6.53, longitude: 3.38 }; // ~1km away
  const far = { activeLoad: 2, id: 'far', latitude: 9.0765, longitude: 7.3986 }; // Abuja, ~500km away

  const winner = selectLowestScoreCandidate([far, near], origin, DEFAULT_DISPATCH_WEIGHTS);
  expectEqual(winner?.id, 'near', 'equal load: the nearer candidate scores lower and wins');
});

Deno.test('selectLowestScoreCandidate: least-loaded wins at equal distance', () => {
  const busy = { activeLoad: 5, id: 'busy', latitude: 6.53, longitude: 3.38 };
  const free = { activeLoad: 0, id: 'free', latitude: 6.53, longitude: 3.38 }; // same spot - equal distance

  const winner = selectLowestScoreCandidate([busy, free], origin, DEFAULT_DISPATCH_WEIGHTS);
  expectEqual(winner?.id, 'free', 'equal distance: the less-loaded candidate scores lower and wins');
});

Deno.test('selectLowestScoreCandidate: empty pool returns null', () => {
  const winner = selectLowestScoreCandidate([], origin, DEFAULT_DISPATCH_WEIGHTS);
  expectEqual(winner, null, 'no candidates: no winner');
});

Deno.test('selectLowestScoreCandidate: ties break on activeLoad, then id - deterministic under repetition', () => {
  // Same load, same coordinates (or no coordinates) - every tiebreak collapses
  // to id ('b' < 'z' lexicographically), and running it many times must
  // always land on the same winner. This is the property that replaces the
  // old weighted-random pick.
  const candidates = [
    { activeLoad: 1, id: 'z-rider', latitude: null, longitude: null },
    { activeLoad: 1, id: 'b-rider', latitude: null, longitude: null },
    { activeLoad: 1, id: 'm-rider', latitude: null, longitude: null },
  ];

  const results = new Set<string | undefined>();
  for (let i = 0; i < 50; i++) {
    // A fresh array each time (spread/shuffle-order-independent input) so
    // this also proves the result doesn't depend on iteration order.
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    results.add(selectLowestScoreCandidate(shuffled, origin, DEFAULT_DISPATCH_WEIGHTS)?.id);
  }

  expectEqual(results.size, 1, 'repeated selection over the same tied pool always picks the same winner');
  expectEqual([...results][0], 'b-rider', 'lexicographically smallest id wins an all-else-equal tie');
});

Deno.test('selectLowestScoreCandidate: a lower activeLoad beats a lower id when scores tie', () => {
  const candidates = [
    { activeLoad: 2, id: 'a-rider', latitude: null, longitude: null },
    { activeLoad: 1, id: 'z-rider', latitude: null, longitude: null },
  ];

  const winner = selectLowestScoreCandidate(candidates, origin, DEFAULT_DISPATCH_WEIGHTS);
  expectEqual(winner?.id, 'z-rider', 'activeLoad is the first tiebreak, before id');
});

// ---------------------------------------------------------------------------
// runAutomaticDispatchAssignment against a fake serviceClient.
//
// TASK 10 CHANGED WHAT THIS SECTION PROVES. Selection no longer claims a
// courier; it creates a `pending` DeliveryOffer and touches NO ledger state.
// So the fake rpc below mirrors ebuy_offer_dispatch_assignment
// (20260816_dispatch_delivery_offers.sql) instead of the claim, and every
// test here asserts `riderLoad` is still 0 afterwards - selection incrementing
// anything is now itself the regression.
//
// The rpc mock is deliberately STRICT about the function name: it throws on
// ebuy_claim_dispatch_assignment. A regression that goes back to claiming at
// selection time fails loudly here rather than passing with a silently
// leaked +1.
//
// Every read returns a structuredClone, never a live row. Task 9's round-4
// harness handed out live references, so a handler's "snapshot" mutated
// itself and a race test passed with the fix fully reverted.
// ---------------------------------------------------------------------------

type MockOffer = {
  courierId: string;
  id: string;
  orderId: string;
  respondsBy: string;
  sequence: number;
  status: string;
};

type MockState = {
  adminRoleLookups: number;
  assignment: { courierId: string | null } | null;
  broadcastCount: number;
  deliveryEvents: Array<Record<string, unknown>>;
  offers: MockOffer[];
  riderLoad: Record<string, number>;
};

const RESTAURANT_ID = 'restaurant-1';
const RIDER_ID = 'rider-1';
const ORDER_ID = 'order-1';
const MAX_OFFERS = 3;

const buildOrder = () => ({
  customerId: 'customer-1',
  fulfillmentType: 'delivery',
  id: ORDER_ID,
  restaurantId: RESTAURANT_ID,
  restaurantName: 'Test Kitchen',
});

const snapshot = <T>(value: T): T => structuredClone(value);

const installMocks = (riderIds: string[] = [RIDER_ID]): MockState => {
  const state: MockState = {
    adminRoleLookups: 0,
    assignment: null,
    broadcastCount: 0,
    deliveryEvents: [],
    offers: [],
    riderLoad: Object.fromEntries(riderIds.map((id) => [id, 0])),
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'UserRole') {
      return {
        select: () => ({
          eq: (_col: string, _val: string) => ({
            eq: async (_c2: string, _v2: string) => ({
              data: snapshot(riderIds.map((id) => ({ restaurantId: RESTAURANT_ID, userId: id }))),
              error: null,
            }),
            is: async (_c2: string, _v2: null) => ({ data: [], error: null }),
          }),
          // notifyAdmins' own role lookup - a different chain shape
          // (.select('userId,role').in('role', ['admin'])) than the
          // dispatch-candidate loader above.
          in: async () => {
            state.adminRoleLookups += 1;
            return { data: [], error: null };
          },
        }),
      };
    }

    if (table === 'UserAccount') {
      return {
        select: () => ({
          in: async (_col: string, _ids: string[]) => ({
            data: snapshot(riderIds.map((id) => ({ accountDisabled: false, expoPushToken: null, uid: id }))),
            error: null,
          }),
        }),
      };
    }

    if (table === 'DispatchRiderRecord') {
      return {
        select: () => ({
          in: async (_col: string, _ids: string[]) => ({
            data: snapshot(
              riderIds.map((id, index) => ({
                activeLoad: state.riderLoad[id] ?? 0,
                // Ordered so the scorer's id tiebreak is deterministic and the
                // walk down the pool on each re-offer is predictable.
                displayName: `Rider ${index + 1}`,
                id,
                latitude: null,
                longitude: null,
                status: 'Available',
              }))
            ),
            error: null,
          }),
        }),
      };
    }

    if (table === 'RestaurantRecord') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { latitude: null, longitude: null }, error: null }),
          }),
        }),
      };
    }

    if (table === 'DeliveryOffer') {
      return {
        select: () => ({
          eq: async (_col: string, orderId: string) => ({
            data: snapshot(
              state.offers
                .filter((offer) => offer.orderId === orderId)
                // respondsBy is part of the real select - loadOrderOfferSummary
                // needs it to tell a live offer from a lapsed-but-unswept one.
                .map((offer) => ({
                  courierId: offer.courierId,
                  respondsBy: offer.respondsBy,
                  status: offer.status,
                }))
            ),
            error: null,
          }),
        }),
      };
    }

    if (table === 'DeliveryEvent') {
      return {
        eq: () => {
          throw new Error('unexpected DeliveryEvent chain');
        },
        insert: async (payload: Record<string, unknown>) => {
          state.deliveryEvents.push(snapshot(payload));
          return { error: null };
        },
        select: () => ({
          eq: (_c1: string, orderId: string) => ({
            eq: (_c2: string, eventType: string) => ({
              maybeSingle: async () => {
                const existing = state.deliveryEvents.find(
                  (event) => event.orderId === orderId && event.eventType === eventType
                );
                return { data: existing ? { id: 'event-1' } : null, error: null };
              },
            }),
          }),
        }),
      };
    }

    throw new Error(`dispatchSelection.test.ts: unexpected table "${table}"`);
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    // Selection must never reach the claim any more. If it does, that is the
    // exact regression this task exists to prevent.
    if (fn !== 'ebuy_offer_dispatch_assignment') {
      throw new Error(`dispatchSelection.test.ts: unexpected rpc "${fn}"`);
    }

    const orderId = params.p_order_id as string;
    const courierId = params.p_courier_id as string;
    const maxOffers = (params.p_max_offers as number) ?? MAX_OFFERS;

    // Mirrors the migration's guard order exactly.
    if (state.assignment?.courierId) {
      return { data: [{ offerId: null, offered: false, reason: 'already_assigned', sequence: null }], error: null };
    }

    const forOrder = state.offers.filter((offer) => offer.orderId === orderId);

    // Lazy expiry, mirroring the migration's `respondsBy <= now` UPDATE under
    // the order lock. The mock did not model this, which made the M-1 fix
    // untestable: selection's own pendingCount check would short-circuit
    // before ever reaching here, so nothing observed whether this ran.
    for (const offer of forOrder) {
      if (offer.status === 'pending' && Date.parse(offer.respondsBy) <= Date.now()) {
        offer.status = 'expired';
      }
    }

    if (forOrder.some((offer) => offer.status === 'pending')) {
      return { data: [{ offerId: null, offered: false, reason: 'offer_outstanding', sequence: null }], error: null };
    }

    if (forOrder.length >= maxOffers) {
      return { data: [{ offerId: null, offered: false, reason: 'exhausted', sequence: null }], error: null };
    }

    // The unique (orderId, courierId) index.
    if (forOrder.some((offer) => offer.courierId === courierId)) {
      return { data: [{ offerId: null, offered: false, reason: 'already_offered', sequence: null }], error: null };
    }

    const sequence = forOrder.length + 1;
    const offerId = `offer-${orderId}-${sequence}`;
    state.offers.push({
      courierId,
      id: offerId,
      orderId,
      respondsBy: new Date(Date.now() + 45_000).toISOString(),
      sequence,
      status: 'pending',
    });

    return { data: [{ offerId, offered: true, reason: 'offered', sequence }], error: null };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/realtime/v1/api/broadcast')) {
      state.broadcastCount += 1;
      return new Response('{}', { status: 200 });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  return state;
};

const weightsLoader = async () => DEFAULT_DISPATCH_WEIGHTS;

const runSelection = (state: MockState, status = 'accepted') =>
  runAutomaticDispatchAssignment(
    buildOrder() as never,
    state.assignment as never,
    'restaurant-owner-uid',
    status,
    weightsLoader
  );

Deno.test('runAutomaticDispatchAssignment: offers the only eligible rider on accepted, and claims nothing', async () => {
  const state = installMocks();

  const outcome = await runSelection(state);

  expectEqual(outcome.outcome, 'offered', 'first attempt offers to the sole candidate');
  expectEqual(state.offers.length, 1, 'exactly one DeliveryOffer row created');
  expectEqual(state.offers[0]?.status, 'pending', 'the offer is pending, not accepted');
  expectEqual(state.offers[0]?.courierId, RIDER_ID, 'offered to the scored winner');
  expectEqual(state.offers[0]?.sequence, 1, 'first offer is sequence 1');
  // THE CLAIM-TIMING INVARIANT, asserted directly: selection is now a pure
  // intent-recording step. No assignment row, no load.
  expectEqual(state.riderLoad[RIDER_ID], 0, 'selection does NOT increment activeLoad');
  expectEqual(state.assignment, null, 'selection does NOT create a DeliveryAssignment');
  expectEqual(state.deliveryEvents.length, 1, 'exactly one DeliveryEvent written');
  expectEqual(state.deliveryEvents[0]?.eventType, 'dispatch_offered', 'offer path event type');
  expectEqual(state.broadcastCount, 1, 'order-changed broadcast fired once');
});

Deno.test('runAutomaticDispatchAssignment: a second attempt while an offer is live does not create a second offer', async () => {
  const state = installMocks();

  // Two callers that both believe nothing is outstanding - a re-delivered
  // status change, or the accepted -> preparing retry arriving while the
  // rider still has time on the clock.
  const first = await runSelection(state);
  const second = await runSelection(state, 'preparing');

  expectEqual(first.outcome, 'offered', 'first attempt creates the offer');
  expectEqual(second.outcome, 'offer_outstanding', 'second attempt is refused, not an error');
  expectEqual(state.offers.length, 1, 'exactly one offer across both attempts');
  expectEqual(state.riderLoad[RIDER_ID], 0, 'no activeLoad movement across either attempt');
  expectEqual(state.deliveryEvents.length, 1, 'exactly one DeliveryEvent across both attempts');
  expectEqual(state.broadcastCount, 1, 'exactly one broadcast across both attempts');
});

Deno.test('runAutomaticDispatchAssignment: a declined offer is re-offered to the next rider, never the same one', async () => {
  const state = installMocks(['rider-1', 'rider-2']);

  const first = await runSelection(state);
  expectEqual(first.outcome, 'offered', 'first rider is offered');
  const firstCourier = state.offers[0]?.courierId;

  // The rider declines - exactly what ebuy_decline_dispatch_offer does to the
  // row, and nothing else. No counter anywhere moves.
  state.offers[0].status = 'declined';

  const second = await runSelection(state, 'preparing');

  expectEqual(second.outcome, 'offered', 'a decline frees the order to be re-offered');
  expectEqual(state.offers.length, 2, 'a second offer row exists');
  const secondCourier = state.offers[1]?.courierId;
  expectEqual(secondCourier === firstCourier, false, 'the decliner is EXCLUDED from the re-offer');
  expectEqual(state.offers[1]?.sequence, 2, 'the re-offer is sequence 2');
  expectEqual(state.riderLoad[firstCourier ?? ''], 0, 'the decliner was never incremented, so nothing to release');
  expectEqual(state.riderLoad[secondCourier ?? ''], 0, 'the new offeree is not incremented either');
});

Deno.test('runAutomaticDispatchAssignment: exhausting the pool of riders falls back to the manual queue once', async () => {
  const state = installMocks(['rider-1', 'rider-2']);

  // Offer and decline through both available riders.
  await runSelection(state);
  state.offers[0].status = 'declined';
  await runSelection(state, 'preparing');
  state.offers[1].status = 'declined';

  // Nobody left to ask: every eligible rider is already excluded.
  const exhausted = await runSelection(state, 'ready_for_pickup');
  expectEqual(exhausted.outcome, 'exhausted', 'running out of riders is exhaustion, not pool_empty');
  expectEqual(state.offers.length, 2, 'no third offer was created');

  const exhaustionEvents = state.deliveryEvents.filter(
    (event) => event.eventType === 'dispatch_offers_exhausted'
  );
  expectEqual(exhaustionEvents.length, 1, 'exactly one dispatch_offers_exhausted event');
  expectEqual(state.adminRoleLookups, 1, 'admin was notified exactly once');

  // The retry on a later status transition must not page admin again.
  const again = await runSelection(state, 'ready_for_pickup');
  expectEqual(again.outcome, 'exhausted', 'still exhausted on retry');
  expectEqual(
    state.deliveryEvents.filter((event) => event.eventType === 'dispatch_offers_exhausted').length,
    1,
    'exhaustion is recorded once per order, not once per retry'
  );
  expectEqual(state.adminRoleLookups, 1, 'admin is NOT re-paged on the retry');
  expectEqual(state.riderLoad['rider-1'], 0, 'exhaustion touches no counter (rider-1)');
  expectEqual(state.riderLoad['rider-2'], 0, 'exhaustion touches no counter (rider-2)');
});

Deno.test('runAutomaticDispatchAssignment: stops after MAX_DISPATCH_OFFERS even when riders remain', async () => {
  const state = installMocks(['rider-1', 'rider-2', 'rider-3', 'rider-4']);

  for (let index = 0; index < 3; index += 1) {
    const outcome = await runSelection(state, 'preparing');
    expectEqual(outcome.outcome, 'offered', `offer ${index + 1} created`);
    state.offers[index].status = 'declined';
  }

  expectEqual(state.offers.length, 3, 'three offers made');

  // rider-4 has never been offered this order and is still eligible - the cap
  // is what stops here, not the exclusion set.
  const fourth = await runSelection(state, 'preparing');
  expectEqual(fourth.outcome, 'exhausted', 'the offer cap is enforced with candidates still available');
  expectEqual(state.offers.length, 3, 'no fourth offer row');
  expectEqual(state.riderLoad['rider-4'], 0, 'the untouched rider is unaffected');
});

Deno.test('runAutomaticDispatchAssignment: skips non-delivery and non-eligible-status orders', async () => {
  const state = installMocks();

  const pickupOutcome = await runAutomaticDispatchAssignment(
    { ...buildOrder(), fulfillmentType: 'pickup' } as never,
    null,
    'uid',
    'accepted',
    weightsLoader
  );
  expectEqual(pickupOutcome.outcome, 'skipped', 'pickup orders are never auto-assigned');

  const deliveredOutcome = await runAutomaticDispatchAssignment(
    buildOrder() as never,
    null,
    'uid',
    'delivered',
    weightsLoader
  );
  expectEqual(deliveredOutcome.outcome, 'skipped', 'terminal-adjacent statuses outside the gate are skipped');

  expectEqual(state.deliveryEvents.length, 0, 'no DeliveryEvent written for skipped attempts');
});

// ---------------------------------------------------------------------------
// releaseDispatchAssignmentLoad: the other end of the lifecycle (review
// finding, round 2 - activeLoad was incremented on auto-assign but never
// released on DELIVERED/REJECTED). The fake rpc below mirrors
// ebuy_release_dispatch_assignment_load's `loadReleasedAt is null` guard,
// symmetric with the claim guard above.
// ---------------------------------------------------------------------------

const installReleaseMocks = (startingLoad = 1) => {
  const state = { loadReleasedAt: null as string | null, riderLoad: startingLoad };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    if (fn !== 'ebuy_release_dispatch_assignment_load') {
      throw new Error(`dispatchSelection.test.ts: unexpected rpc "${fn}"`);
    }
    // Order-keyed only (review round 4): the row decides which rider holds
    // the claim, so passing a courier id at all is what let a release
    // silently no-op against a legitimately reassigned row.
    if (params.p_order_id !== ORDER_ID || 'p_courier_id' in params) {
      throw new Error('dispatchSelection.test.ts: unexpected release rpc arguments');
    }

    if (state.loadReleasedAt) {
      return { data: [{ released: false }], error: null };
    }

    state.loadReleasedAt = new Date().toISOString();
    state.riderLoad -= 1;
    return { data: [{ released: true }], error: null };
  };

  return state;
};

Deno.test('releaseDispatchAssignmentLoad: releases exactly once, and a second call for the same order is a no-op', async () => {
  const state = installReleaseMocks();

  const first = await releaseDispatchAssignmentLoad(ORDER_ID);
  const second = await releaseDispatchAssignmentLoad(ORDER_ID);

  expectEqual(first, true, 'first release succeeds');
  expectEqual(second, false, 'second release for the same order+courier is guarded off, not a double-decrement');
  expectEqual(state.riderLoad, 0, 'activeLoad decremented exactly once across both calls');
});

// Review round 2's regression: dispatchUpdateOrderStatus (the
// dispatcher-driven DELIVERED/FAILED_DELIVERY path) used to call the plain
// adjustDispatchRiderLoad(-1) directly instead of
// releaseDispatchAssignmentLoad, so it couldn't see partnerUpdateOrderStatus's
// (the partner-driven DELIVERED/REJECTED path) release and vice versa - two
// uncoordinated decrements could land for one claimed unit. Both call sites
// now call this exact function, so this test exercises the invariant "for
// each (order, courier) claim, exactly one decrement ever lands" the way it
// actually happens in production: a dispatcher's release completing first
// (rider genuinely no longer carrying the order), followed by a "stale"
// partner request that read its order/assignment snapshot before the
// dispatcher's write landed and is only now getting around to calling
// release for the same, already-terminal order.
Deno.test('releaseDispatchAssignmentLoad: a dispatcher release followed by a stale partner release for the same claim decrements exactly once', async () => {
  // activeLoad starts at 3: two other genuinely active orders plus the one
  // claim under test, matching the review's numeric example.
  const state = installReleaseMocks(3);

  const dispatcherRelease = await releaseDispatchAssignmentLoad(ORDER_ID);
  expectEqual(dispatcherRelease, true, "the dispatcher's release (first to complete) wins the claim");
  expectEqual(state.riderLoad, 2, 'one decrement after the dispatcher path releases');

  const stalePartnerRelease = await releaseDispatchAssignmentLoad(ORDER_ID);
  expectEqual(stalePartnerRelease, false, "the stale partner release for the same order is a guarded no-op");
  expectEqual(state.riderLoad, 2, 'still 2, not 1 - the stale release must not land a second decrement for the same claim');
});

// ---------------------------------------------------------------------------
// Empty pool: recordDispatchPoolEmpty, reached through
// runAutomaticDispatchAssignment (it is a private helper, not exported -
// tested the same black-box way every other case in this file is). Per the
// brief, this path had never executed before this task; per review, it
// needed its own coverage rather than relying on the assignment tests above
// to exercise it incidentally.
// ---------------------------------------------------------------------------

type EmptyPoolMockState = {
  adminRoleLookups: number;
  deliveryEvents: Array<Record<string, unknown>>;
  poolEmptyEventLookups: number;
};

/**
 * Every dispatch-role query (restaurant-scoped and global) returns no
 * candidates, so the scorer always comes back empty and
 * runAutomaticDispatchAssignment always falls into recordDispatchPoolEmpty.
 * `rpc` throws if called at all - the claim function must never run for an
 * order with nothing to claim against.
 */
const installEmptyPoolMocks = (): EmptyPoolMockState => {
  const state: EmptyPoolMockState = {
    adminRoleLookups: 0,
    deliveryEvents: [],
    poolEmptyEventLookups: 0,
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'UserRole') {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: [], error: null }),
            is: async () => ({ data: [], error: null }),
          }),
          // loadUserIdsByRoles (notifyAdmins' push lookup) queries
          // .select('userId,role').in('role', ['admin']) - a different
          // chain shape than the dispatch-candidate loader above.
          in: async () => {
            state.adminRoleLookups += 1;
            return { data: [], error: null };
          },
        }),
      };
    }

    if (table === 'RestaurantRecord') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { latitude: null, longitude: null }, error: null }),
          }),
        }),
      };
    }

    // Nobody has ever been offered this order, so the exclusion set is empty -
    // which is exactly what makes an empty pool `pool_empty` (retryable, a
    // rider coming online fixes it) rather than `exhausted` (we walked the
    // whole pool and ran out of people to ask).
    if (table === 'DeliveryOffer') {
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      };
    }

    if (table === 'DeliveryEvent') {
      return {
        insert: async (payload: Record<string, unknown>) => {
          state.deliveryEvents.push(payload);
          return { error: null };
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                state.poolEmptyEventLookups += 1;
                const alreadyRecorded = state.deliveryEvents.some(
                  (event) => event.eventType === 'dispatch_pool_empty'
                );
                return { data: alreadyRecorded ? { id: 'pool-empty-event-1' } : null, error: null };
              },
            }),
          }),
        }),
      };
    }

    throw new Error(`dispatchSelection.test.ts: unexpected table "${table}" in the empty-pool scenario`);
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string) => {
    throw new Error(`dispatchSelection.test.ts: rpc "${fn}" must not run against an empty pool`);
  };

  return state;
};

Deno.test('runAutomaticDispatchAssignment: an empty pool records one dispatch_pool_empty event and notifies admins', async () => {
  const state = installEmptyPoolMocks();

  const outcome = await runAutomaticDispatchAssignment(
    buildOrder() as never,
    null,
    'restaurant-owner-uid',
    'accepted',
    weightsLoader
  );

  expectEqual(outcome.outcome, 'pool_empty', 'no eligible courier in either pool');
  expectEqual(state.deliveryEvents.length, 1, 'exactly one DeliveryEvent written');
  expectEqual(state.deliveryEvents[0]?.eventType, 'dispatch_pool_empty', 'event type');
  expectEqual(
    (state.deliveryEvents[0]?.details as Record<string, unknown> | undefined)?.restaurantId,
    RESTAURANT_ID,
    'event details record which restaurant hit the empty pool'
  );
  expectEqual(state.adminRoleLookups, 1, 'notifyAdmins looked up admin recipients exactly once');
});

Deno.test('runAutomaticDispatchAssignment: a second attempt against the same still-empty pool does not re-notify', async () => {
  const state = installEmptyPoolMocks();

  const first = await runAutomaticDispatchAssignment(
    buildOrder() as never,
    null,
    'restaurant-owner-uid',
    'accepted',
    weightsLoader
  );
  const second = await runAutomaticDispatchAssignment(
    buildOrder() as never,
    null,
    'restaurant-owner-uid',
    'preparing',
    weightsLoader
  );

  expectEqual(first.outcome, 'pool_empty', 'first attempt: pool empty');
  expectEqual(second.outcome, 'pool_empty', 'retry on the next status change: pool still empty');
  expectEqual(state.deliveryEvents.length, 1, 'still exactly one DeliveryEvent - the once-per-order guard held');
  expectEqual(state.adminRoleLookups, 1, 'admins were notified once, not once per retry');
});

// M-1: loadOrderOfferSummary counted `status = 'pending'` without consulting
// respondsBy. A lapsed-but-unswept offer therefore made selection return
// `offer_outstanding` and short-circuit BEFORE calling
// ebuy_offer_dispatch_assignment - so the lazy expiry inside that function,
// which exists precisely to stop a dead offer blocking the next one, could
// never run. The order waited up to a full sweep interval for a re-offer.
//
// Driven through a status transition rather than the sweep on purpose: the
// sweep's pass 1 expires the row first, so it never exercises the
// lapsed-while-still-pending state this fix is about.
Deno.test('runAutomaticDispatchAssignment: a lapsed but unswept offer does not block the next offer', async () => {
  const state = installMocks(['rider-1', 'rider-2']);

  const first = await runSelection(state);
  expectEqual(first.outcome, 'offered', 'the first rider is offered');

  // The 45s window closes, but the cron sweep has not run yet - the row is
  // still `pending`.
  state.offers[0].respondsBy = new Date(Date.now() - 1000).toISOString();

  const second = await runSelection(state, 'preparing');

  expectEqual(second.outcome, 'offered', 'the lapsed offer does NOT block the next one');
  expectEqual(state.offers[0]?.status, 'expired', 'the lapsed offer was expired on the way through');
  expectEqual(state.offers.length, 2, 'a second offer exists');
  expectEqual(state.offers[1]?.courierId, 'rider-2', 'it went to the next rider');
  expectEqual(state.riderLoad['rider-1'], 0, 'no counter movement');
  expectEqual(state.riderLoad['rider-2'], 0, 'no counter movement');
});
