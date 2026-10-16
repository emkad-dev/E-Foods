// Handler-scoping tests for rider fleet reads (SP-1 Task 1): a dispatch-role
// caller must only ever receive their OWN DispatchRiderRecord, admin gets the
// fleet through the PII-free coarse projection, and dispatchGetNearestRiders
// is admin-only.
//
// Calls the REAL handlers out of dispatchDomain.handlers. The env stubs must
// be set before the dynamic import (client.ts throws at module scope without
// them). This file runs in package.json's second, --no-check `deno test`
// invocation because dispatch.ts carries pre-existing baseline type errors -
// see dispatchSelection.test.ts and domains/adminSetRestaurantPublished.test.ts
// for the fuller explanation.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./domains/dispatch.ts');
const { serviceClient } = await import('./client.ts');

const expect = (cond: boolean, label: string) => {
  if (!cond) throw new Error(label);
};

const getRiders = dispatchDomain.handlers.dispatchGetRiders;
const getNearest = dispatchDomain.handlers.dispatchGetNearestRiders;
if (typeof getRiders !== 'function' || typeof getNearest !== 'function') {
  throw new Error('dispatch handlers are not registered.');
}

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const ctx = (role: string, uid: string) => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

const RIDERS = [
  {
    id: 'rider-a', displayName: 'Ada', status: 'Available', zone: 'Yaba', vehicleType: 'Bike',
    licenseNumber: 'LIC-A', vehiclePlateNumber: 'PLATE-A', verificationStatus: 'approved',
    activeLoad: 1, latitude: 6.512345, longitude: 3.378912, updatedAt: '2026-01-02',
  },
  {
    id: 'rider-b', displayName: 'Bayo', status: 'Available', zone: 'Ikeja', vehicleType: 'Bike',
    licenseNumber: 'LIC-B', vehiclePlateNumber: 'PLATE-B', verificationStatus: 'approved',
    activeLoad: 0, latitude: 6.6, longitude: 3.3, updatedAt: '2026-01-01',
  },
];

type Recorded = { eqCalls: Array<[string, unknown]> };

const installMocks = (): Recorded => {
  const recorded: Recorded = { eqCalls: [] };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'DispatchRiderRecord') {
      let filterId: string | null = null;
      let inIds: string[] | null = null;
      const result = () => {
        let rows = RIDERS;
        if (filterId !== null) rows = rows.filter((r) => r.id === filterId);
        if (inIds !== null) rows = rows.filter((r) => inIds!.includes(r.id));
        return { data: rows, error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        eq: (column: string, value: string) => {
          recorded.eqCalls.push([column, value]);
          if (column === 'id') filterId = value;
          return builder;
        },
        in: (_column: string, values: string[]) => {
          inIds = values;
          return builder;
        },
        // Thenable so `await query` works like a real PostgREST builder.
        // deno-lint-ignore no-explicit-any
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
      };
      return builder;
    }

    if (table === 'rider_live_location') {
      return { select: async () => ({ data: [], error: null }) };
    }

    throw new Error(`dispatchFleetScope.test.ts: unexpected table "${table}"`);
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (name: string) => {
    if (name === 'ebuy_nearest_riders') {
      return { data: [{ rider_id: 'rider-a', metres: 120 }], error: null };
    }
    throw new Error(`dispatchFleetScope.test.ts: unexpected rpc "${name}"`);
  };

  return recorded;
};

const ridersOf = async (response: Response) =>
  (await response.json()).data.riders as Array<Record<string, unknown>>;

Deno.test('dispatch-role dispatchGetRiders returns only the caller own full record', async () => {
  const recorded = installMocks();
  const res = await getRiders({ context: ctx('dispatch', 'rider-a'), data: {}, request: fakeRequest() } as never);
  const riders = await ridersOf(res);
  expect(riders.length === 1, `expected 1 rider, got ${riders.length}`);
  expect(riders[0].id === 'rider-a', 'must be the caller own record');
  expect(riders[0].licenseNumber === 'LIC-A', 'caller sees their own licence');
  expect(
    recorded.eqCalls.some(([c, v]) => c === 'id' && v === 'rider-a'),
    'query must be scoped to the caller uid'
  );
});

Deno.test('admin dispatchGetRiders returns the fleet without PII and with coarse location', async () => {
  installMocks();
  const res = await getRiders({ context: ctx('admin', 'admin-1'), data: {}, request: fakeRequest() } as never);
  const riders = await ridersOf(res);
  expect(riders.length === 2, `expected 2 riders, got ${riders.length}`);
  for (const r of riders) {
    expect(!('licenseNumber' in r), 'licenseNumber must be absent for the admin fleet view');
    expect(!('vehiclePlateNumber' in r), 'plate must be absent for the admin fleet view');
  }
  const ada = riders.find((r) => r.id === 'rider-a')!;
  expect(ada.latitude === 6.512 && ada.longitude === 3.379, 'location must be coarsened');
});

Deno.test('dispatchGetNearestRiders rejects the dispatch role with 403', async () => {
  installMocks();
  let threw: unknown = null;
  try {
    await getNearest({
      context: ctx('dispatch', 'rider-a'),
      data: { latitude: 6.5, longitude: 3.3 },
      request: fakeRequest(),
    } as never);
  } catch (error) {
    threw = error;
  }
  expect(threw !== null, 'dispatch role must be rejected');
  expect((threw as { status?: number }).status === 403, 'expected a 403 rejection');
});

Deno.test('admin dispatchGetNearestRiders returns the PII-free projection plus metres', async () => {
  installMocks();
  const res = await getNearest({
    context: ctx('admin', 'admin-1'),
    data: { latitude: 6.5, longitude: 3.3 },
    request: fakeRequest(),
  } as never);
  const riders = await ridersOf(res);
  expect(riders.length === 1 && riders[0].id === 'rider-a', 'expected the nearest rider');
  expect(riders[0].metres === 120, 'metres must be preserved');
  expect(!('licenseNumber' in riders[0]) && !('vehiclePlateNumber' in riders[0]), 'no PII for nearest riders');
});
