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

Deno.test('scoreDispatchCandidate: missing coordinates on either side degrade to load-only', () => {
  const noCandidateCoords = scoreDispatchCandidate(
    { activeLoad: 3, id: 'a', latitude: null, longitude: null },
    origin,
    DEFAULT_DISPATCH_WEIGHTS
  );
  expectEqual(noCandidateCoords, DEFAULT_DISPATCH_WEIGHTS.load * 3, 'no candidate coordinates: distance term is 0');

  const noOriginCoords = scoreDispatchCandidate(
    { activeLoad: 3, id: 'a', latitude: 6.6, longitude: 3.4 },
    null,
    DEFAULT_DISPATCH_WEIGHTS
  );
  expectEqual(noOriginCoords, DEFAULT_DISPATCH_WEIGHTS.load * 3, 'no origin coordinates: distance term is 0');
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
