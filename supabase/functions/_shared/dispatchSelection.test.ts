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
// Idempotency: runAutomaticDispatchAssignment against a fake serviceClient.
// The fake RPC below mirrors ebuy_claim_dispatch_assignment's contract
// (20260814_dispatch_auto_assignment.sql): claim only succeeds while
// courierId is still null, and only a successful claim increments load.
// ---------------------------------------------------------------------------

type MockState = {
  assignment: { courierId: string | null } | null;
  broadcastCount: number;
  deliveryEvents: Array<Record<string, unknown>>;
  riderLoad: Record<string, number>;
};

const RESTAURANT_ID = 'restaurant-1';
const RIDER_ID = 'rider-1';
const ORDER_ID = 'order-1';

const buildOrder = () => ({
  customerId: 'customer-1',
  fulfillmentType: 'delivery',
  id: ORDER_ID,
  restaurantId: RESTAURANT_ID,
  restaurantName: 'Test Kitchen',
});

const installMocks = (): MockState => {
  const state: MockState = {
    assignment: null,
    broadcastCount: 0,
    deliveryEvents: [],
    riderLoad: { [RIDER_ID]: 0 },
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'UserRole') {
      return {
        select: () => ({
          eq: (_col: string, _val: string) => ({
            eq: async (_c2: string, _v2: string) => ({
              data: [{ restaurantId: RESTAURANT_ID, userId: RIDER_ID }],
              error: null,
            }),
            is: async (_c2: string, _v2: null) => ({ data: [], error: null }),
          }),
        }),
      };
    }

    if (table === 'UserAccount') {
      return {
        select: () => ({
          in: async (_col: string, _ids: string[]) => ({
            data: [{ accountDisabled: false, expoPushToken: null, uid: RIDER_ID }],
            error: null,
          }),
        }),
      };
    }

    if (table === 'DispatchRiderRecord') {
      return {
        select: () => ({
          in: async (_col: string, _ids: string[]) => ({
            data: [
              {
                activeLoad: state.riderLoad[RIDER_ID],
                displayName: 'Ada Rider',
                id: RIDER_ID,
                latitude: null,
                longitude: null,
                status: 'Available',
              },
            ],
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

    if (table === 'DeliveryEvent') {
      return {
        eq: () => {
          throw new Error('unexpected DeliveryEvent chain');
        },
        insert: async (payload: Record<string, unknown>) => {
          state.deliveryEvents.push(payload);
          return { error: null };
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    }

    throw new Error(`dispatchSelection.test.ts: unexpected table "${table}"`);
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    if (fn !== 'ebuy_claim_dispatch_assignment') {
      throw new Error(`dispatchSelection.test.ts: unexpected rpc "${fn}"`);
    }

    // Mirrors the migration's guard: only claim while courierId is null.
    if (state.assignment?.courierId) {
      return { data: [{ claimed: false }], error: null };
    }

    state.assignment = { courierId: params.p_courier_id as string };
    state.riderLoad[params.p_courier_id as string] = (state.riderLoad[params.p_courier_id as string] ?? 0) + 1;
    return { data: [{ claimed: true }], error: null };
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

Deno.test('runAutomaticDispatchAssignment: assigns the only eligible rider on accepted', async () => {
  const state = installMocks();

  const outcome = await runAutomaticDispatchAssignment(
    buildOrder() as never,
    null,
    'restaurant-owner-uid',
    'accepted',
    weightsLoader
  );

  expectEqual(outcome.outcome, 'assigned', 'first attempt assigns the sole candidate');
  expectEqual(state.riderLoad[RIDER_ID], 1, 'activeLoad incremented exactly once');
  expectEqual(state.deliveryEvents.length, 1, 'exactly one DeliveryEvent written');
  expectEqual(state.deliveryEvents[0]?.eventType, 'dispatch_assigned', 'automatic path event type');
  expectEqual(state.broadcastCount, 1, 'order-changed broadcast fired once on success');
});

Deno.test('runAutomaticDispatchAssignment: a second concurrent attempt does not double-assign or double-increment load', async () => {
  const state = installMocks();

  // Two callers that both believe no courier is assigned yet - the exact
  // shape of a re-delivered status change or two rapid `accepted`
  // transitions racing each other, since neither has seen the other's write.
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
    'accepted',
    weightsLoader
  );

  expectEqual(first.outcome, 'assigned', 'first attempt wins the claim');
  expectEqual(second.outcome, 'already_assigned', 'second attempt loses the claim, not an error');
  expectEqual(state.riderLoad[RIDER_ID], 1, 'activeLoad incremented exactly once across both attempts');
  expectEqual(state.deliveryEvents.length, 1, 'exactly one DeliveryEvent across both attempts');
  expectEqual(state.broadcastCount, 1, 'exactly one broadcast across both attempts');
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
