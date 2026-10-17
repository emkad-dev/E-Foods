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
