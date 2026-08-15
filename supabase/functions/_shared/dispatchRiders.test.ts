// ensureDispatchRiderRecord must never write activeLoad (review round 4).
//
// It is an upsert on the rider's id, and PostgREST's `on conflict do update`
// only touches the columns present in the payload - so a payload carrying
// activeLoad reset a live counter to 0 on every re-provisioning of an
// EXISTING dispatcher: assignUserRole, restoreUserRole, an admin approving a
// dispatch application for an id that already has a record, and a rider
// re-submitting their own onboarding all call it. Every one of those call
// sites passed a literal 0, so the field could only ever clobber a value,
// never set a meaningful one - dropping that rider's in-flight claims out of
// the ledger the scorer reads.
//
// The column is INTEGER NOT NULL DEFAULT 0, so omitting it leaves a
// brand-new record at exactly the 0 it used to be handed explicitly. This
// runs in package.json's second, --no-check `deno test` invocation for the
// same reason the domain tests do: _shared/client.ts throws at module scope
// unless the env vars are set first, so the module is imported dynamically.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ensureDispatchRiderRecord } = await import('./dispatchRiders.ts');
const { serviceClient } = await import('./client.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.test('ensureDispatchRiderRecord: the upsert payload carries no activeLoad, so re-provisioning cannot reset a live claim count', async () => {
  const upserts: Array<Record<string, unknown>> = [];

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table !== 'DispatchRiderRecord') {
      throw new Error(`dispatchRiders.test.ts: unexpected table "${table}"`);
    }
    return {
      upsert(payload: Record<string, unknown>, opts?: { onConflict?: string }) {
        upserts.push({ ...payload, __onConflict: opts?.onConflict });
        return Promise.resolve({ error: null });
      },
    };
  };

  await ensureDispatchRiderRecord('rider-1', {
    acceptanceRate: 100,
    completedTrips: 0,
    displayName: 'Ada Rider',
    status: 'Available',
    vehicleType: 'bike',
    zone: 'Yaba',
  });

  expectEqual(upserts.length, 1, 'one upsert was issued');
  expectEqual(upserts[0].__onConflict, 'id', 'it is an id-keyed upsert - it updates an existing row in place');
  expectEqual(
    Object.prototype.hasOwnProperty.call(upserts[0], 'activeLoad'),
    false,
    'activeLoad is absent from the payload, so an existing rider keeps the load ledger they had'
  );
  expectEqual(upserts[0].id, 'rider-1', 'the record is still keyed and written as before');
  expectEqual(upserts[0].displayName, 'Ada Rider', 'the profile fields are still written');
});
