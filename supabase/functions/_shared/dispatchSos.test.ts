// SP-5 SOS test: verify that dispatchRiderSOS is registered and enforces role
// access correctly.
//
// Uses the --no-check invocation in test:deno because the domain modules
// statically import _shared/client.ts, which throws at module scope without
// SUPABASE_URL / SERVICE_ROLE_KEY set first.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./domains/dispatch.ts');
const { serviceClient } = await import('./client.ts');

// Every read answers "nothing found". The SOS handler deliberately degrades
// past failed lookups (it must never refuse a rider in trouble), so without
// this stub it reached the admin-notification path against an unreachable
// localhost Supabase and sat in network retries for minutes. Behaviour with
// real fixtures is covered in dispatchRiderAuthz.test.ts.
const installEmptyDatabase = () => {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    // deno-lint-ignore no-explicit-any
    then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
  };
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = () => builder;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async () => ({ data: null, error: null });
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const DISPATCH_CONTEXT = {
  email: 'rider@example.test',
  role: 'dispatch',
  token: 'fake-token',
  uid: 'test-uid-00001',
  userProfile: { uid: 'test-uid-00001', email: 'rider@example.test', role: 'dispatch', accountDisabled: false },
};

// --- 1. Handler registration --------------------------------------------------

Deno.test('dispatchRiderSOS handler is registered', () => {
  if (typeof dispatchDomain.handlers.dispatchRiderSOS !== 'function') {
    throw new Error('dispatchDomain.handlers.dispatchRiderSOS is not registered.');
  }
});

// --- 2. dispatch role can call the handler -----------------------------------
//
// We cannot hit a real DB in this test, so we accept any DB-related error.
// The test asserts only that the handler does NOT throw a role-guard error.

Deno.test('dispatchRiderSOS: dispatch role — handler is callable', async () => {
  const handler = dispatchDomain.handlers.dispatchRiderSOS;
  if (typeof handler !== 'function') {
    throw new Error('dispatchDomain.handlers.dispatchRiderSOS is not registered.');
  }

  installEmptyDatabase();
  let thrown: unknown = null;
  try {
    // deno-lint-ignore no-explicit-any
    await (handler as any)({
      context: DISPATCH_CONTEXT,
      data: { orderId: 'test-order' },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  // A DB error (404, 500) is acceptable; a role-guard error (403 / Unauthorized) is not.
  if (thrown !== null) {
    const status = (thrown as { status?: number })?.status;
    const msg = (thrown as Error)?.message ?? '';
    if (status === 403 || /unauthorized|role/i.test(msg)) {
      throw new Error(`Expected no role-guard error, but got: ${msg}`);
    }
  }
});

// --- 3. non-dispatch role is rejected ----------------------------------------

Deno.test('dispatchRiderSOS: non-dispatch role is rejected', async () => {
  const handler = dispatchDomain.handlers.dispatchRiderSOS;
  if (typeof handler !== 'function') {
    throw new Error('dispatchDomain.handlers.dispatchRiderSOS is not registered.');
  }

  let thrown: unknown = null;
  try {
    // deno-lint-ignore no-explicit-any
    await (handler as any)({
      context: {
        email: 'customer@example.test',
        role: 'customer',
        token: 'fake-token',
        uid: 'customer-uid',
        userProfile: { uid: 'customer-uid', email: 'customer@example.test', role: 'customer', accountDisabled: false },
      },
      data: { orderId: 'test-order' },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  if (thrown === null) {
    throw new Error('Expected role-guard error, but handler returned successfully.');
  }

  const status = (thrown as { status?: number })?.status;
  const msg = (thrown as Error)?.message ?? '';
  if (status !== 403 && !/unauthorized|role/i.test(msg)) {
    throw new Error(`Expected 403 or role error, got status=${status} msg="${msg}"`);
  }
});
