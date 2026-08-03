// Smoke tests for the five domain-scoped RPC entrypoints added in task A2
// (feasty-orders, feasty-dispatch, feasty-partner, feasty-admin,
// feasty-account). Each function's index.ts does exactly two things: import
// its own domain module and call `buildDispatcher([<thatDomain>])`. This
// suite reproduces that exact construction against the REAL domain modules
// (not synthetic stubs) so that importing the wrong domain into one of the
// five index.ts files — the mis-wiring this suite exists to catch — would
// show up here as a wrong action list, not just at review time.
//
// Two assertions per function, matching task-2-brief.md's intent:
//
//   1. An action that belongs to a *different* domain (proxy for "an action
//      this function does not implement") resolves to no handler under
//      either lookup. That null is exactly what _shared/rpc/serve.ts's
//      `executeAction` turns into the 501 "not implemented in the native
//      Supabase backend" response — the SAME literal code path app-rpc has
//      used all along (see serve.ts, `nativeResponse ?? json(501, ...)`).
//      task-2-brief.md calls this a 404; it is not, and Task 1 deliberately
//      kept 501 for an unimplemented action. This suite follows the code.
//
//      Getting an actual 501 *HTTP response* out of createRpcHttpHandler for
//      this case requires a caller who is already authenticated — per
//      _shared/rpc/context.ts's createRpcDispatch, everything except the two
//      pre-auth actions authenticates BEFORE the handler lookup runs, so an
//      unauthenticated request for an unknown action answers 401, not 501
//      (that is exactly assertion 2, below). To exercise the real HTTP path
//      through to 501 without standing up a live Supabase project, this
//      suite monkey-patches the shared `serviceClient` singleton's
//      `auth.getUser` / `from(...)` so authentication succeeds with a fake
//      profile; no handler ever runs for a null lookup, so nothing beyond
//      that fake profile needs to be real.
//
//   2. A privileged (non-anonymous) action belonging to that function's own
//      domain, requested with no Authorization header, is rejected 401
//      before any handler executes — proof the auth-first ordering survived
//      moving the dispatcher into its own Edge Function. No mocking needed:
//      `_shared/auth.ts`'s `getBearerToken` throws before any network call.
//
// Runs env-vars-then-dynamic-import, same as registry.real-domains.test.ts
// and for the same reason: the domain modules import _shared/client.ts,
// which throws at module-evaluation time without SUPABASE_URL /
// SERVICE_ROLE_KEY, and a hoisted top-level `import` would run before this
// file's test bodies get a chance to set them. See that file for the fuller
// explanation, including why this lives in package.json's second, --no-check
// `deno test` invocation rather than the type-checked one.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const [
  { ordersDomain },
  { dispatchDomain },
  { partnerDomain },
  { adminDomain },
  { accountDomain },
] = await Promise.all([
  import('../domains/orders.ts'),
  import('../domains/dispatch.ts'),
  import('../domains/partner.ts'),
  import('../domains/admin.ts'),
  import('../domains/account.ts'),
]);

const { buildDispatcher } = await import('./registry.ts');
const { createRpcHttpHandler } = await import('./serve.ts');
const { serviceClient } = await import('../client.ts');

// Monkey-patch the shared service-role client so getAuthenticatedRequestContext
// resolves without a live Supabase project. Only assertion 1 (the 501 case)
// ever reaches this — assertion 2 (the 401 case) throws before any network
// call, real or faked, is made.
const FAKE_UID = 'smoke-test-uid';
const fakeUser = { id: FAKE_UID, email: 'smoketest@example.test', app_metadata: {} };

// deno-lint-ignore no-explicit-any
(serviceClient.auth as any).getUser = async () => ({ data: { user: fakeUser }, error: null });
// deno-lint-ignore no-explicit-any
(serviceClient as any).from = (_table: string) => ({
  select: (_columns: string) => ({
    eq: (_column: string, _value: string) => ({
      maybeSingle: async () => ({
        data: {
          uid: FAKE_UID,
          email: fakeUser.email,
          role: 'customer',
          accountDisabled: false,
        },
        error: null,
      }),
    }),
  }),
});

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

const postRequest = (action: string, headers: HeadersInit = {}) =>
  new Request('https://example.test/rpc', {
    body: JSON.stringify({ action, data: {} }),
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  });

const AUTHED_HEADERS = { authorization: 'Bearer fake-jwt-for-smoke-test' };

type EntrypointFixture = {
  // deno-lint-ignore no-explicit-any
  domain: any;
  foreignAction: string;
  functionName: string;
  privilegedAction: string;
};

// Each fixture's `foreignAction` is a real action owned by a *different*
// domain — proof this function's dispatcher, built the same way its index.ts
// builds it, does not accidentally answer for another domain's action.
const FIXTURES: EntrypointFixture[] = [
  {
    domain: ordersDomain,
    foreignAction: 'dispatchGetRiders',
    functionName: 'feasty-orders',
    privilegedAction: 'customerGetOrders',
  },
  {
    domain: dispatchDomain,
    foreignAction: 'partnerGetRestaurantContext',
    functionName: 'feasty-dispatch',
    privilegedAction: 'dispatchGetRiders',
  },
  {
    domain: partnerDomain,
    foreignAction: 'adminGetDashboardSnapshot',
    functionName: 'feasty-partner',
    privilegedAction: 'partnerGetRestaurantContext',
  },
  {
    domain: adminDomain,
    foreignAction: 'customerGetOrders',
    functionName: 'feasty-admin',
    privilegedAction: 'adminGetDashboardSnapshot',
  },
  {
    domain: accountDomain,
    foreignAction: 'upsertDispatchRiderProfile',
    functionName: 'feasty-account',
    privilegedAction: 'assignUserRole',
  },
];

for (const fixture of FIXTURES) {
  const dispatcher = buildDispatcher([fixture.domain]);
  const handler = createRpcHttpHandler(fixture.functionName, dispatcher);

  Deno.test(
    `${fixture.functionName}: an action outside its own domain answers 501, not 404, for an authenticated caller`,
    async () => {
      const response = await handler(postRequest(fixture.foreignAction, AUTHED_HEADERS));
      expectEqual(response.status, 501, `${fixture.functionName} foreign-action status`);
      const body = await response.json();
      expectEqual(
        body?.error?.message,
        `The RPC action "${fixture.foreignAction}" is not implemented in the native Supabase backend.`,
        `${fixture.functionName} foreign-action error message`
      );
    }
  );

  Deno.test(
    `${fixture.functionName}: an unauthenticated privileged action is rejected 401, never executed`,
    async () => {
      const response = await handler(postRequest(fixture.privilegedAction));
      expectEqual(response.status, 401, `${fixture.functionName} unauthenticated privileged-action status`);
    }
  );
}
