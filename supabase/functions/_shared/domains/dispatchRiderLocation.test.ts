// Tests for the Task 11 (D3) rider-position-history throttle, driven through
// the REAL syncDispatchRiderLocation handler in the real dispatch domain map
// - not a standalone call to recordDispatchRiderPing - for the reason every
// other *.test.ts in this directory gives: a helper can be correctly tested
// while the handler that is supposed to call it silently isn't wired up, and
// only exercising the real handler catches that class of regression.
//
// _shared/client.ts throws at module scope without SUPABASE_URL /
// SERVICE_ROLE_KEY set first, so the two env vars are set here before the
// domain module is imported dynamically - the same pattern
// dispatchLoadRelease.test.ts and adminSetRestaurantPublished.test.ts use.
// dispatch.ts carries pre-existing baseline `deno check` errors
// (scripts/deno-check-baseline.txt), so this file runs in package.json's
// second, --no-check `deno test` invocation, like those two.
//
// The mock rpc for ebuy_record_dispatch_rider_ping mirrors the migration's
// throttle logic (20260820_dispatch_rider_ping.sql: "is there a ping for this
// rider newer than now - throttleSeconds") against a test-controlled `now`,
// so the 10s/11s boundary is deterministic rather than depending on real
// wall-clock time. Every assertion is against the mock's own stored rows
// (`state.pings`) - never "was the rpc called" - so a handler that stopped
// calling recordDispatchRiderPing entirely would fail these tests exactly as
// loudly as one that got the throttle backwards.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./dispatch.ts');
const { serviceClient } = await import('../client.ts');

const syncDispatchRiderLocation = dispatchDomain.handlers.syncDispatchRiderLocation;
if (typeof syncDispatchRiderLocation !== 'function') {
  throw new Error('dispatchDomain.handlers.syncDispatchRiderLocation is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const RIDER_ID = 'rider-ping-1';
const ACTIVE_ORDER_ID = 'order-active-1';

const DISPATCH_CONTEXT = {
  email: 'rider@example.test',
  role: 'dispatch',
  token: 'fake-token',
  uid: RIDER_ID,
  userProfile: { uid: RIDER_ID, email: 'rider@example.test', role: 'dispatch', accountDisabled: false },
};

type PingRow = {
  accuracy: number | null;
  id: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  riderId: string;
};

/**
 * Installs a fake DispatchRiderRecord table (the admin-only existence check), a
 * fake unlogged `rider_live_location` table (the current-position write every
 * call now makes) and a fake ebuy_record_dispatch_rider_ping rpc that mirrors
 * the migration's own throttle predicate against `state.now`, a clock the test
 * advances explicitly rather than relying on real elapsed time between calls.
 *
 * ebuy_touch_rider_durable_location is stubbed too: the durable
 * DispatchRiderRecord copy is throttled in SQL, so from the edge function's
 * side it is just a fire-and-log rpc whose failure must not fail the ping.
 */
type BroadcastMessage = { event?: string; payload?: Record<string, unknown>; topic?: string };

const installMocks = (options: { activeOrderIds?: string[] } = {}) => {
  const activeOrderIds = options.activeOrderIds ?? [ACTIVE_ORDER_ID];
  const state = {
    now: Date.now(),
    pings: [] as PingRow[],
    liveLocationUpserts: [] as Record<string, unknown>[],
    durableSyncs: [] as Record<string, unknown>[],
    broadcasts: [] as BroadcastMessage[],
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'DispatchRiderRecord') {
      return {
        select: (_columns?: string) => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => ({
              data: val === RIDER_ID ? { id: RIDER_ID } : null,
              error: null,
            }),
          }),
        }),
      };
    }

    // The unlogged live-position table: written on EVERY ping, unthrottled.
    if (table === 'rider_live_location') {
      return {
        upsert: async (payload: Record<string, unknown>, _options?: Record<string, unknown>) => {
          state.liveLocationUpserts.push({ ...payload });
          return { error: null };
        },
      };
    }

    // The rider-position broadcast fan-out (loadRiderActiveOrderIds) reads the
    // rider's assignments, then the status of those orders. Snapshots, not
    // live references.
    if (table === 'DeliveryAssignment') {
      return {
        select: (_columns?: string) => ({
          eq: async (_col: string, _val: string) => ({
            data: activeOrderIds.map((orderId) => ({ orderId })),
            error: null,
          }),
        }),
      };
    }

    if (table === 'CustomerOrder') {
      return {
        select: (_columns?: string) => ({
          in: (_col: string, ids: string[]) => ({
            in: async (_statusCol: string, _statuses: string[]) => ({
              // Every assigned order is treated as in-transit for this test.
              data: ids.map((id) => ({ id, status: 'on_the_way' })),
              error: null,
            }),
          }),
        }),
      };
    }

    throw new Error(`dispatchRiderLocation.test.ts: unexpected table "${table}"`);
  };

  // Capture the realtime broadcast POSTs instead of hitting the network, so
  // the recorded-gate and the on-the-wire payload whitelist are both asserted
  // against the exact messages emitted.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = async (input: unknown, init?: { body?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? '');
    if (url.includes('/realtime/v1/api/broadcast') && init?.body) {
      const parsed = JSON.parse(init.body) as { messages?: BroadcastMessage[] };
      for (const message of parsed.messages ?? []) {
        state.broadcasts.push(message);
      }
    }
    return new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } });
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    if (fn === 'ebuy_touch_rider_durable_location') {
      state.durableSyncs.push({ ...params });
      return { data: null, error: null };
    }

    if (fn !== 'ebuy_record_dispatch_rider_ping') {
      throw new Error(`dispatchRiderLocation.test.ts: unexpected rpc "${fn}"`);
    }

    const riderId = params.p_rider_id as string;
    const throttleMs = ((params.p_throttle_seconds as number) ?? 10) * 1000;
    const hasRecentPing = state.pings.some(
      (ping) => ping.riderId === riderId && state.now - Date.parse(ping.recordedAt) < throttleMs
    );

    if (hasRecentPing) {
      return { data: [{ pingId: null, recorded: false }], error: null };
    }

    const ping: PingRow = {
      accuracy: (params.p_accuracy as number | null | undefined) ?? null,
      id: `ping-${state.pings.length + 1}`,
      latitude: params.p_latitude as number,
      longitude: params.p_longitude as number,
      recordedAt: new Date(state.now).toISOString(),
      riderId,
    };
    state.pings.push(ping);

    return { data: [{ pingId: ping.id, recorded: true }], error: null };
  };

  return state;
};

Deno.test('syncDispatchRiderLocation: a second ping 5 seconds later (inside the 10s window) is dropped', async () => {
  const state = installMocks();

  const first = await syncDispatchRiderLocation({
    context: DISPATCH_CONTEXT,
    data: { accuracy: 10, latitude: 6.5, longitude: 3.4 },
    request: fakeRequest(),
  });
  expectEqual(first.status, 200, 'the first sync succeeds');
  const firstBody = (await first.json()) as { data: { pingRecorded: boolean } };
  expectEqual(firstBody.data.pingRecorded, true, 'the first call recorded a history row');
  expectEqual(state.pings.length, 1, 'exactly one history row exists after the first call');

  state.now += 5000; // 5 seconds later - still inside the 10s throttle window

  const second = await syncDispatchRiderLocation({
    context: DISPATCH_CONTEXT,
    data: { accuracy: 8, latitude: 6.51, longitude: 3.41 },
    request: fakeRequest(),
  });

  expectEqual(second.status, 200, 'the handler still succeeds - a throttled ping is not treated as an error');
  const secondBody = (await second.json()) as { data: { pingRecorded: boolean } };
  expectEqual(secondBody.data.pingRecorded, false, 'the response reports the history append was dropped');
  expectEqual(state.pings.length, 1, 'the second ping inside 10s produced NO new history row');
  expectEqual(
    state.liveLocationUpserts.length,
    2,
    'the CURRENT position on rider_live_location still writes on every call, unthrottled - the throttle governs only the history append'
  );
  expectEqual(
    state.liveLocationUpserts[1].latitude,
    6.51,
    'the current-position write reflects the latest call even though its history append was throttled'
  );
  expectEqual(
    state.durableSyncs.length,
    2,
    'the durable DispatchRiderRecord sync is attempted on every call - the once-per-interval throttle is enforced in SQL, not here'
  );
});

Deno.test('syncDispatchRiderLocation: a ping 11 seconds later (outside the 10s window) is kept', async () => {
  const state = installMocks();

  await syncDispatchRiderLocation({
    context: DISPATCH_CONTEXT,
    data: { accuracy: 10, latitude: 6.5, longitude: 3.4 },
    request: fakeRequest(),
  });
  expectEqual(state.pings.length, 1, 'exactly one history row exists after the first call');

  state.now += 11000; // 11 seconds later - past the 10s throttle window

  const response = await syncDispatchRiderLocation({
    context: DISPATCH_CONTEXT,
    data: { accuracy: 12, latitude: 6.52, longitude: 3.42 },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'the second sync succeeds');
  const body = (await response.json()) as { data: { pingRecorded: boolean } };
  expectEqual(body.data.pingRecorded, true, 'the response reports a new history row was recorded');
  expectEqual(state.pings.length, 2, 'a ping 11 seconds later produces a second history row');
  expectEqual(state.pings[1].latitude, 6.52, 'the new row carries the newly reported position');
  expectEqual(state.pings[0].latitude, 6.5, 'the first row is untouched - this is an append, not an overwrite');
});

Deno.test('syncDispatchRiderLocation: a RECORDED ping broadcasts the rider position to the active order, whitelisted', async () => {
  const state = installMocks();

  const response = await syncDispatchRiderLocation({
    context: DISPATCH_CONTEXT,
    data: { accuracy: 9, latitude: 6.5244, longitude: 3.3792 },
    request: fakeRequest(),
  });
  expectEqual(response.status, 200, 'the sync succeeds');

  expectEqual(state.broadcasts.length, 1, 'exactly one broadcast emitted for the single active order');
  const message = state.broadcasts[0];
  expectEqual(message.topic, `order-${ACTIVE_ORDER_ID}`, 'broadcast targets the order-<id> topic of the active order');
  expectEqual(message.event, 'rider-position', 'the event is the distinct rider-position event, not the generic changed event');

  const payload = message.payload ?? {};
  const keys = Object.keys(payload).sort();
  expectEqual(
    JSON.stringify(keys),
    JSON.stringify(['latitude', 'longitude', 'updatedAt']),
    'the on-the-wire payload contains exactly the three whitelisted keys'
  );
  expectEqual(payload.latitude, 6.5244, 'latitude carried through to the wire');
  expectEqual(payload.longitude, 3.3792, 'longitude carried through to the wire');
  // The rider id must never reach the customer - it identifies the rider and
  // the ping row it came from.
  for (const forbidden of ['riderId', 'id', 'phoneNumber', 'courierId', 'accuracy', 'name', 'zone']) {
    if (forbidden in payload) {
      throw new Error(`the customer payload leaked a forbidden field: ${forbidden}`);
    }
  }
});

Deno.test('syncDispatchRiderLocation: a THROTTLED ping emits NO position broadcast', async () => {
  const state = installMocks();

  await syncDispatchRiderLocation({
    context: DISPATCH_CONTEXT,
    data: { accuracy: 9, latitude: 6.5, longitude: 3.4 },
    request: fakeRequest(),
  });
  expectEqual(state.broadcasts.length, 1, 'the first, recorded ping broadcast once');

  state.now += 5000; // inside the 10s throttle window - this ping is dropped

  const second = await syncDispatchRiderLocation({
    context: DISPATCH_CONTEXT,
    data: { accuracy: 8, latitude: 6.51, longitude: 3.41 },
    request: fakeRequest(),
  });
  expectEqual(second.status, 200, 'the throttled sync still succeeds');
  expectEqual(
    state.broadcasts.length,
    1,
    'the throttled ping produced NO new broadcast - the broadcast rides the recorded gate, inheriting the 10s throttle'
  );
});
