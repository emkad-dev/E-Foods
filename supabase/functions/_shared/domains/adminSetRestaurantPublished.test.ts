// Tests for the `adminSetRestaurantPublished` handler (Task 25 of the
// parity plan): an admin can publish/unpublish an already-approved
// restaurant without going through the application flow again.
//
// This calls the REAL handler out of the real `adminDomain.handlers` map
// (not a synthetic stub), the same way registry.real-domains.test.ts and
// serve.real-entrypoints.test.ts do, and for the same reason: the domain
// modules statically import `_shared/client.ts`, which throws at module
// scope without SUPABASE_URL / SERVICE_ROLE_KEY set first. A normal
// top-level `import` is hoisted and evaluated before any test body runs, so
// this file sets the two env vars, then dynamically imports the domain
// module — see registry.real-domains.test.ts's header comment for the fuller
// explanation, including why this needs to run in package.json's second,
// --no-check `deno test` invocation (the domain modules carry pre-existing
// `deno check` type errors, tracked separately, that a type-checked
// invocation would otherwise trip over).
//
// Calling the handler directly (rather than going through
// createRpcHttpHandler / HTTP) skips `getAuthenticatedRequestContext`
// entirely, so the fake `context` below is handed straight to the handler —
// there is no JWT or `user_profiles` lookup to fake here, only the handler's
// own `serviceClient.from(...)` calls (RestaurantRecord update, AdminAuditLog
// insert) and the realtime broadcast's raw `fetch`.

// `_shared/client.ts` reads SERVICE_ROLE_KEY; `_shared/realtime.ts` (which
// `broadcastRestaurantsChanged` needs to actually call `fetch` instead of
// silently no-op'ing) reads the differently-named SUPABASE_SERVICE_ROLE_KEY.
// Both must be set before the dynamic import below for the broadcast
// assertions to be meaningful.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { adminDomain } = await import('./admin.ts');
const { serviceClient } = await import('../client.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const handler = adminDomain.handlers.adminSetRestaurantPublished;
if (typeof handler !== 'function') {
  throw new Error('adminDomain.handlers.adminSetRestaurantPublished is not registered.');
}

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const ADMIN_CONTEXT = {
  email: 'admin@example.test',
  role: 'admin',
  token: 'fake-token',
  uid: 'admin-uid',
  userProfile: { uid: 'admin-uid', email: 'admin@example.test', role: 'admin', accountDisabled: false },
};

type RestaurantRow = { id: string; name: string; isPublished: boolean };

type MockState = {
  auditInserts: Array<Record<string, unknown>>;
  broadcasts: Array<{ url: string; body: unknown }>;
  restaurant: RestaurantRow | null;
  updateCalls: Array<Record<string, unknown>>;
};

/**
 * Installs a fresh set of `serviceClient.from(...)` and `fetch` fakes and
 * returns the mutable state they record into, so each test can assert on
 * exactly the calls the handler made and nothing carries over between tests.
 */
const installMocks = (initialRestaurant: RestaurantRow | null): MockState => {
  const state: MockState = {
    auditInserts: [],
    broadcasts: [],
    restaurant: initialRestaurant,
    updateCalls: [],
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'RestaurantRecord') {
      return {
        update: (payload: Record<string, unknown>) => {
          state.updateCalls.push(payload);
          return {
            eq: (_column: string, value: string) => ({
              select: (_columns: string) => ({
                maybeSingle: async () => {
                  if (!state.restaurant || state.restaurant.id !== value) {
                    return { data: null, error: null };
                  }
                  state.restaurant = {
                    ...state.restaurant,
                    isPublished: payload.isPublished as boolean,
                  };
                  return { data: state.restaurant, error: null };
                },
              }),
            }),
          };
        },
      };
    }

    if (table === 'AdminAuditLog') {
      return {
        insert: async (payload: Record<string, unknown>) => {
          state.auditInserts.push(payload);
          return { error: null };
        },
      };
    }

    throw new Error(`adminSetRestaurantPublished.test.ts: unexpected table "${table}"`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/realtime/v1/api/broadcast')) {
      state.broadcasts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response('{}', { status: 200 });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  return state;
};

Deno.test('adminSetRestaurantPublished: rejects a non-admin caller with 403 before touching the database', async () => {
  const state = installMocks({ id: 'restaurant-1', name: 'Test Kitchen', isPublished: false });

  let thrown: unknown = null;
  try {
    await handler({
      context: { ...ADMIN_CONTEXT, role: 'restaurant' },
      data: { restaurantId: 'restaurant-1', isPublished: true },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  expectEqual(thrown instanceof Error, true, 'a non-admin caller should throw');
  expectEqual((thrown as { status?: number })?.status, 403, 'non-admin status');
  expectEqual(state.updateCalls.length, 0, 'no RestaurantRecord update for a rejected caller');
  expectEqual(state.auditInserts.length, 0, 'no audit row for a rejected caller');
  expectEqual(state.broadcasts.length, 0, 'no broadcast for a rejected caller');
});

Deno.test('adminSetRestaurantPublished: an unknown restaurant answers 404', async () => {
  const state = installMocks(null);

  let thrown: unknown = null;
  try {
    await handler({
      context: ADMIN_CONTEXT,
      data: { restaurantId: 'does-not-exist', isPublished: true },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  expectEqual(thrown instanceof Error, true, 'an unknown restaurant should throw');
  expectEqual((thrown as { status?: number })?.status, 404, 'unknown restaurant status');
  expectEqual(state.auditInserts.length, 0, 'no audit row for an unknown restaurant');
  expectEqual(state.broadcasts.length, 0, 'no broadcast for an unknown restaurant');
});

Deno.test('adminSetRestaurantPublished: publishing persists isPublished=true, writes an audit row, and broadcasts', async () => {
  const state = installMocks({ id: 'restaurant-2', name: 'Jollof Spot', isPublished: false });

  const response = await handler({
    context: ADMIN_CONTEXT,
    data: { restaurantId: 'restaurant-2', isPublished: true },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'publish response status');
  const body = await response.json();
  expectEqual(body?.data?.isPublished, true, 'response reflects isPublished=true');
  expectEqual(state.restaurant?.isPublished, true, 'RestaurantRecord.isPublished persisted true');

  expectEqual(state.auditInserts.length, 1, 'exactly one audit row written');
  expectEqual(state.auditInserts[0]?.action, 'restaurant_published', 'audit action for publish');
  expectEqual(state.auditInserts[0]?.actorUid, 'admin-uid', 'audit actor');
  expectEqual(state.auditInserts[0]?.targetType, 'restaurant', 'audit target type');
  expectEqual(state.auditInserts[0]?.targetId, 'restaurant-2', 'audit target id');

  expectEqual(state.broadcasts.length, 1, 'exactly one broadcast fired');
  const messages = (state.broadcasts[0]?.body as { messages?: Array<{ topic: string }> })?.messages ?? [];
  expectEqual(
    messages.some((message) => message.topic === 'restaurants'),
    true,
    'broadcast includes the restaurants topic'
  );
});

Deno.test('adminSetRestaurantPublished: unpublishing persists isPublished=false and writes an audit row', async () => {
  const state = installMocks({ id: 'restaurant-3', name: 'Suya Corner', isPublished: true });

  const response = await handler({
    context: ADMIN_CONTEXT,
    data: { restaurantId: 'restaurant-3', isPublished: false },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'unpublish response status');
  const body = await response.json();
  expectEqual(body?.data?.isPublished, false, 'response reflects isPublished=false');
  expectEqual(state.restaurant?.isPublished, false, 'RestaurantRecord.isPublished persisted false');

  expectEqual(state.auditInserts.length, 1, 'exactly one audit row written');
  expectEqual(state.auditInserts[0]?.action, 'restaurant_unpublished', 'audit action for unpublish');

  expectEqual(state.broadcasts.length, 1, 'exactly one broadcast fired');
});

Deno.test('adminSetRestaurantPublished: rejects a missing restaurantId with 400', async () => {
  const state = installMocks({ id: 'restaurant-4', name: 'Test Kitchen', isPublished: false });

  let thrown: unknown = null;
  try {
    await handler({
      context: ADMIN_CONTEXT,
      data: { isPublished: true },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 400, 'missing restaurantId status');
  expectEqual(state.updateCalls.length, 0, 'no update attempted without a restaurantId');
});

Deno.test('adminSetRestaurantPublished: rejects a non-boolean isPublished with 400', async () => {
  const state = installMocks({ id: 'restaurant-5', name: 'Test Kitchen', isPublished: false });

  let thrown: unknown = null;
  try {
    await handler({
      context: ADMIN_CONTEXT,
      data: { restaurantId: 'restaurant-5', isPublished: 'yes' },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 400, 'non-boolean isPublished status');
  expectEqual(state.updateCalls.length, 0, 'no update attempted with a non-boolean isPublished');
});
