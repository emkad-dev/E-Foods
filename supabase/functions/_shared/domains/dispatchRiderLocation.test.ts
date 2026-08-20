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
 * Installs a fake DispatchRiderRecord table (existence check + current-
 * position update) and a fake ebuy_record_dispatch_rider_ping rpc that
 * mirrors the migration's own throttle predicate against `state.now`, a
 * clock the test advances explicitly rather than relying on real elapsed
 * time between calls.
 */
const installMocks = () => {
  const state = {
    now: Date.now(),
    pings: [] as PingRow[],
    riderUpdates: [] as Record<string, unknown>[],
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table !== 'DispatchRiderRecord') {
      throw new Error(`dispatchRiderLocation.test.ts: unexpected table "${table}"`);
    }

    return {
      select: (_columns?: string) => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: async () => ({
            data: val === RIDER_ID ? { id: RIDER_ID } : null,
            error: null,
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_col: string, _val: string) => {
          state.riderUpdates.push({ ...payload });
          return { error: null };
        },
      }),
    };
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
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
    state.riderUpdates.length,
    2,
    'the CURRENT position on DispatchRiderRecord still updates on every call, unthrottled - the throttle governs only the history append'
  );
  expectEqual(
    state.riderUpdates[1].latitude,
    6.51,
    'the current-position update reflects the latest call even though its history append was throttled'
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
