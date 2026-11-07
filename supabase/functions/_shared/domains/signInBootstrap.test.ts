// dispatchBootstrap / partnerBootstrap: interactive sign-in reads the caller's
// own profile row in one call instead of a direct PostgREST read.
//
// These drive the REAL handlers out of the REAL domain maps (the way
// dispatchRiderProfileLoad.test.ts does) because the risks are in the wiring:
// the row must be keyed by the AUTHENTICATED uid and never by request data, the
// call must be readable by a caller who is not yet a rider / restaurant (pending
// applicants and invited staff sign in through it), and it must expose nothing
// beyond the columns the direct read already returned. Runs in package.json's
// --no-check `deno test` invocation; imports dynamically because
// _shared/client.ts throws at module scope without these env vars.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./dispatch.ts');
const { partnerDomain } = await import('./partner.ts');
const { serviceClient } = await import('../client.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

// A signed-in CUSTOMER: the role a pending rider/partner applicant still has.
const contextFor = (uid: string) => ({
  email: `${uid}@example.test`,
  role: 'customer',
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role: 'customer', accountDisabled: false },
});

type Lookup = { columns: string; table: string; uidFilter: unknown };

const withProfileRow = async (
  result: { data: Record<string, unknown> | null; error: { message: string } | null },
  run: (lookups: Lookup[]) => Promise<void>
) => {
  const lookups: Lookup[] = [];
  const originalFrom = serviceClient.from.bind(serviceClient);

  try {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => {
          if (column !== 'uid') {
            throw new Error(`signInBootstrap.test.ts: unexpected filter column "${column}"`);
          }
          lookups.push({ columns, table, uidFilter: value });
          return { maybeSingle: () => Promise.resolve(result) };
        },
      }),
    });

    await run(lookups);
  } finally {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = originalFrom;
  }
};

const HANDLERS = [
  ['dispatchBootstrap', dispatchDomain.handlers.dispatchBootstrap],
  ['partnerBootstrap', partnerDomain.handlers.partnerBootstrap],
] as const;

for (const [name, handler] of HANDLERS) {
  if (typeof handler !== 'function') {
    throw new Error(`${name} is not registered in its domain.`);
  }

  Deno.test(`${name} returns the caller's own profile row, keyed by the authenticated uid`, async () => {
    const row = { uid: 'caller-uid', email: 'caller-uid@example.test', role: 'customer', activeSessionId: 'dev-1' };

    await withProfileRow({ data: row, error: null }, async (lookups) => {
      // A hostile request naming another user must not steer the read.
      const response = await handler({
        context: contextFor('caller-uid'),
        data: { uid: 'someone-else', userId: 'someone-else' },
        request: fakeRequest(),
      });

      expectEqual(response.status, 200, 'status');
      const body = await response.json();
      expectEqual(body.data.profile.uid, 'caller-uid', 'profile uid');
      expectEqual(body.data.profile.activeSessionId, 'dev-1', 'activeSessionId rides inside the profile');
      expectEqual(Object.keys(body.data).join(','), 'profile', 'response carries only the profile');

      expectEqual(lookups.length, 1, 'one lookup');
      expectEqual(lookups[0].table, 'user_profiles', 'table');
      expectEqual(lookups[0].uidFilter, 'caller-uid', 'filtered by the authenticated uid');
    });
  });

  Deno.test(`${name} selects exactly the columns the direct sign-in read selected`, async () => {
    // packages/auth/src/profileApi.ts USER_PROFILE_COLUMNS, copied here on
    // purpose: widening either side must fail this test, not pass silently.
    const DIRECT_READ_COLUMNS =
      'uid,email,displayName,phoneNumber,photoURL,emailVerified,role,partnerApplicationStatus,partnerApplicationReviewedAt,partnerApplicationRejectionReason,dispatchApplicationStatus,dispatchApplicationReviewedAt,dispatchApplicationRejectionReason,expoPushToken,pushTokenUpdatedAt,activeSessionId,activeSessionUpdatedAt,accountDisabled,disabledAt,disabledByUid,lastPrivilegedRole,restaurantId,restaurantName,restaurantLinkedAt,restaurantLinkSource,createdAt,updatedAt';

    await withProfileRow({ data: null, error: null }, async (lookups) => {
      await handler({ context: contextFor('u1'), data: {}, request: fakeRequest() });
      expectEqual(lookups[0].columns, DIRECT_READ_COLUMNS, 'selected columns');
    });
  });

  Deno.test(`${name} answers profile null for an account with no profile row yet`, async () => {
    await withProfileRow({ data: null, error: null }, async () => {
      const response = await handler({ context: contextFor('new-uid'), data: {}, request: fakeRequest() });

      expectEqual(response.status, 200, 'status');
      expectEqual((await response.json()).data.profile, null, 'profile');
    });
  });

  Deno.test(`${name} surfaces a database error instead of reporting a missing profile`, async () => {
    await withProfileRow({ data: null, error: { message: 'boom' } }, async () => {
      let thrown: unknown = null;
      try {
        await handler({ context: contextFor('u1'), data: {}, request: fakeRequest() });
      } catch (error) {
        thrown = error;
      }

      // A read failure that looked like "no profile" would make the client
      // create a stand-in profile over a real one.
      expectEqual(thrown instanceof Error && thrown.message, 'boom', 'thrown error');
    });
  });
}
