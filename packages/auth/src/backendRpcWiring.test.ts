/**
 * Run with: node --test --experimental-strip-types packages/auth/src/backendRpcWiring.test.ts
 *
 * Proves `callBackendRpc` actually USES the error parser, which
 * `backendRpc.test.ts` cannot.
 *
 * WHY THIS FILE EXISTS. `parseBackendRpcErrorBody` and
 * `backendRpcErrorFromResponse` were written with twelve passing tests, and
 * the call sites were never switched over to them. Both copies of the old,
 * broken block stayed exactly where they were. Every one of those twelve tests
 * passed the entire time, because a tested function that nothing calls is
 * still a tested function.
 *
 * What the user saw, months later, on a real failure:
 *
 *   Backend RPC customerSubmitOrderRating direct URL fallback failed:
 *   [Error: {"error":{"message":"column reference \\"restaurantId\\" is ambiguous"}}]
 *
 * The raw envelope, which is precisely the defect the parser was written to
 * remove. So this test asserts the WIRING -- drive the public entry point with
 * a stubbed transport and check what comes out the other end. A unit test of
 * the parser can never catch a parser that is not reached.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { callBackendRpc, isBackendRpcError } from './backendRpc.ts';

const ENV = {
  backendRpcUrl: 'https://example.supabase.co/functions/v1/app-rpc',
  anonKey: 'anon-key',
  supabaseUrl: 'https://example.supabase.co',
};

/** Just enough Supabase client for the session gate at the top of the call. */
const stubSupabase = () =>
  ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    },
    functions: {
      // Reached only if the direct path returns null; these tests never do.
      invoke: async () => ({ data: null, error: new Error('relay should not be reached') }),
    },
  }) as never;

/** Replace global fetch for one call, then restore it. */
const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('the canonical envelope reaches the caller as a sentence, not as JSON', async () => {
  await withFetch(
    async () =>
      jsonResponse(400, {
        error: { message: 'column reference "restaurantId" is ambiguous' },
      }),
    async () => {
      const failure = await callBackendRpc(stubSupabase(), ENV, 'customerSubmitOrderRating', {})
        .then(() => null)
        .catch((error: unknown) => error);

      assert.ok(failure instanceof Error, 'the call must reject');
      assert.equal(failure.message, 'column reference "restaurantId" is ambiguous');
      // The exact regression: the whole envelope arriving as the message.
      assert.ok(
        !failure.message.includes('{"error"'),
        'the raw JSON envelope must never be the message'
      );
    }
  );
});

test('the thrown error carries the status, so a caller can tell 4xx from 5xx', async () => {
  await withFetch(
    async () => jsonResponse(429, { error: { message: 'Slow down.', code: 'RATE_LIMITED' } }),
    async () => {
      const failure = await callBackendRpc(stubSupabase(), ENV, 'customerSubmitOrderRating', {})
        .then(() => null)
        .catch((error: unknown) => error);

      assert.ok(isBackendRpcError(failure), 'a BackendRpcError, not a bare Error');
      assert.equal(failure.status, 429);
      assert.equal(failure.code, 'RATE_LIMITED');
      assert.equal(failure.message, 'Slow down.');
    }
  );
});

test('a non-JSON body still yields something readable rather than nothing', async () => {
  await withFetch(
    async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    async () => {
      const failure = await callBackendRpc(stubSupabase(), ENV, 'customerSubmitOrderRating', {})
        .then(() => null)
        .catch((error: unknown) => error);

      assert.ok(failure instanceof Error);
      assert.ok(failure.message.trim().length > 0, 'a blank message helps nobody');
    }
  );
});
