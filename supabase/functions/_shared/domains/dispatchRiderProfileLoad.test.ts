// Task 28 [H4]: upsertDispatchRiderProfile must never write activeLoad.
//
// The column is the offer ledger's, incremented by the D2 claim path and
// decremented by releaseDispatchAssignmentLoad, and the single-claim invariant
// Task 9's four review rounds established only holds while nothing else writes
// it. This handler wrote it two different ways:
//
//   * admin branch  - normalizeDispatchRiderDraft did parseInteger(input.activeLoad, 0),
//     so a request that merely OMITTED the field wrote a literal 0 over a live
//     counter. The scorer weights activeLoad at 1.0, so clobbering it to 0 sends
//     that rider MORE work while they are already carrying deliveries.
//   * rider branch  - it read the row and wrote the value straight back, a
//     read-then-write window as long as the profile form stayed open. A claim
//     landing inside that window was erased by the save.
//
// Neither bought anything: the dispatch profile form exposes no activeLoad
// input (only zone, lga and status are editable), so the "let an operator
// correct a drifted counter" capability the field would justify never existed
// in the product. This is the same defect, in the sibling handler, that
// fa1f854 fixed in ensureDispatchRiderRecord - see dispatchRiders.test.ts.
//
// These drive the REAL handler out of the REAL domain map, the way
// dispatchLoadRelease.test.ts and adminSetRestaurantPublished.test.ts do,
// because the defect is in the wiring, not in a pure helper: a unit test over
// normalizeDispatchRiderDraft alone would stay green if the upsert re-added the
// column. Runs in package.json's second, --no-check `deno test` invocation
// (the domain modules carry pre-existing `deno check` errors, baselined in
// scripts/deno-check-baseline.txt), and imports dynamically because
// _shared/client.ts throws at module scope without these env vars.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./dispatch.ts');
const { serviceClient } = await import('../client.ts');

const upsertDispatchRiderProfile = dispatchDomain.handlers.upsertDispatchRiderProfile;
if (typeof upsertDispatchRiderProfile !== 'function') {
  throw new Error('dispatchDomain.handlers.upsertDispatchRiderProfile is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const RIDER_ID = 'rider-with-two-live-deliveries';
// What the ledger actually holds while the rider has the form open.
const LEDGER_ACTIVE_LOAD = 2;

const adminContext = () => ({
  email: 'admin@example.test',
  role: 'admin',
  token: 'fake-token',
  uid: 'admin-uid',
  userProfile: { uid: 'admin-uid', email: 'admin@example.test', role: 'admin', accountDisabled: false },
});

const riderContext = () => ({
  email: 'rider@example.test',
  role: 'dispatch',
  token: 'fake-token',
  uid: RIDER_ID,
  userProfile: { uid: RIDER_ID, email: 'rider@example.test', role: 'dispatch', accountDisabled: false },
});

/**
 * Stands in for DispatchRiderRecord and AdminAuditLog. Records every upsert
 * payload so a test can assert on what the handler actually tried to write,
 * and answers the row read with a live activeLoad so a read-then-write would
 * have something real to clobber.
 */
const withStubbedClient = async (
  run: (upserts: Array<Record<string, unknown>>) => Promise<void>
) => {
  const upserts: Array<Record<string, unknown>> = [];
  const originalFrom = serviceClient.from.bind(serviceClient);
  const originalFetch = globalThis.fetch;

  // broadcastRidersChanged posts to Realtime; keep it off the network.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  try {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = (table: string) => {
      if (table === 'AdminAuditLog') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      if (table !== 'DispatchRiderRecord') {
        throw new Error(`dispatchRiderProfileLoad.test.ts: unexpected table "${table}"`);
      }
      return {
        // The rider branch's pre-read.
        select: (columns: string) => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: RIDER_ID,
                  displayName: 'Ada Rider',
                  status: 'Delivering',
                  zone: 'Lagos',
                  vehicleType: 'Bike',
                  acceptanceRate: 92,
                  activeLoad: LEDGER_ACTIVE_LOAD,
                  completedTrips: 40,
                  latitude: null,
                  longitude: null,
                  region: 'Lagos',
                  lga: 'Yaba',
                  phoneNumber: null,
                  currentAddress: null,
                },
                error: null,
                __columns: columns,
              }),
          }),
        }),
        upsert: (payload: Record<string, unknown>, opts?: { onConflict?: string }) => {
          upserts.push({ ...payload, __onConflict: opts?.onConflict });
          return {
            select: () => ({
              // Postgres returns the row as it stands AFTER the write. Since
              // activeLoad is not in the payload, that is the untouched ledger
              // value - which is exactly the point of the fix.
              maybeSingle: () => Promise.resolve({ data: { activeLoad: LEDGER_ACTIVE_LOAD }, error: null }),
            }),
          };
        },
      };
    };

    await run(upserts);
  } finally {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = originalFrom;
    globalThis.fetch = originalFetch;
  }
};

Deno.test('upsertDispatchRiderProfile: an admin save that OMITS activeLoad does not write the column (the clobber-to-0 path)', async () => {
  await withStubbedClient(async (upserts) => {
    await upsertDispatchRiderProfile({
      context: adminContext(),
      // Exactly what the form sends: no activeLoad key at all.
      data: { riderId: RIDER_ID, name: 'Ada Rider', zone: 'Lagos', lga: 'Yaba', status: 'Available' },
      request: fakeRequest(),
      // deno-lint-ignore no-explicit-any
    } as any);

    expectEqual(upserts.length, 1, 'one upsert was issued');
    expectEqual(upserts[0].__onConflict, 'id', 'it is an id-keyed upsert, so it updates the existing row in place');
    expectEqual(
      Object.prototype.hasOwnProperty.call(upserts[0], 'activeLoad'),
      false,
      'activeLoad is absent from the payload, so the rider keeps the ledger they had'
    );
    expectEqual(upserts[0].zone, 'Lagos', 'the profile fields this handler DOES own are still written');
    expectEqual(upserts[0].status, 'Available', 'an admin can still set status');
  });
});

Deno.test('upsertDispatchRiderProfile: an admin save carrying a STALE activeLoad still does not write the column', async () => {
  await withStubbedClient(async (upserts) => {
    await upsertDispatchRiderProfile({
      context: adminContext(),
      // A client posting back a snapshot it read before the rider took two
      // deliveries. Pre-fix this wrote 0 over a live count of 2.
      data: {
        riderId: RIDER_ID,
        name: 'Ada Rider',
        zone: 'Lagos',
        lga: 'Yaba',
        status: 'Available',
        activeLoad: 0,
      },
      request: fakeRequest(),
      // deno-lint-ignore no-explicit-any
    } as any);

    expectEqual(upserts.length, 1, 'one upsert was issued');
    expectEqual(
      Object.prototype.hasOwnProperty.call(upserts[0], 'activeLoad'),
      false,
      'a value in the request body is ignored entirely - the ledger owns this column'
    );
  });
});

Deno.test('upsertDispatchRiderProfile: a rider saving their own profile neither writes nor round-trips activeLoad', async () => {
  await withStubbedClient(async (upserts) => {
    const response = await upsertDispatchRiderProfile({
      context: riderContext(),
      data: { name: 'Ada Rider', zone: 'Lagos', lga: 'Yaba', status: 'Available', activeLoad: 0 },
      request: fakeRequest(),
      // deno-lint-ignore no-explicit-any
    } as any);

    expectEqual(upserts.length, 1, 'one upsert was issued');
    expectEqual(
      Object.prototype.hasOwnProperty.call(upserts[0], 'activeLoad'),
      false,
      'the read-then-write of the counter is gone - the row read no longer feeds the write'
    );

    // And the response tells the truth about the ledger rather than defaulting
    // the omitted column to 0.
    const body = await response.json();
    expectEqual(
      body.data.rider.activeLoad,
      LEDGER_ACTIVE_LOAD,
      'the response reports the ledger value returned by the write, not a fabricated 0'
    );
  });
});
