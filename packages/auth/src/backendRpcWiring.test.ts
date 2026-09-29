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
import { FunctionsFetchError } from '@supabase/supabase-js';

import { createSentryInitializer, resetSentryStateForTest } from '../../observability/src/sentry.ts';
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

/**
 * Reporting tests below. `callBackendRpc` is the choke point every app's
 * server calls go through, so these drive it end to end with a fake,
 * synchronously-inspectable Sentry SDK rather than mocking `reportError`
 * itself -- the same "drive the public entry point" reasoning the file's
 * header comment gives for testing the wiring instead of just the parser.
 */
const withInitializedSentry = async (
  run: (captured: Array<{ message: string; extra?: Record<string, unknown> }>) => Promise<void>
) => {
  resetSentryStateForTest();

  const captured: Array<{ message: string; extra?: Record<string, unknown> }> = [];

  const initializer = createSentryInitializer({
    getDsn: () => 'https://example.invalid/1',
    getEnvironment: () => 'test',
    getPlatform: () => 'web',
    installHandlers: () => () => undefined,
    loadWebSdk: async () => ({
      captureException: (error: Error, context?: { extra?: Record<string, unknown> }) => {
        captured.push({ message: error.message, extra: context?.extra });
      },
      init: () => undefined,
      setTag: () => undefined,
    }),
  });

  await initializer('customer');

  try {
    await run(captured);
  } finally {
    resetSentryStateForTest();
  }
};

/** No `backendRpcUrl`, so `callViaDirectUrl` returns null immediately and every call goes straight to the relay stub -- no real `fetch` involved. */
const RELAY_ONLY_ENV = { anonKey: 'anon-key', supabaseUrl: 'https://example.supabase.co' };

const stubSupabaseWithRelayError = (error: unknown) =>
  ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    },
    functions: {
      invoke: async () => ({ data: null, error }),
    },
  }) as never;

test('a 500 is reported exactly once', async () => {
  await withInitializedSentry(async (captured) => {
    await withFetch(
      async () => jsonResponse(500, { error: { message: 'db unreachable: connection refused' } }),
      async () => {
        const failure = await callBackendRpc(stubSupabase(), ENV, 'customerSubmitOrderRating', {})
          .then(() => null)
          .catch((error: unknown) => error);

        assert.ok(isBackendRpcError(failure));
        assert.equal(failure.status, 500);
      }
    );

    assert.equal(captured.length, 1, 'a 5xx failure must be reported exactly once');
    assert.equal(captured[0].extra?.action, 'customerSubmitOrderRating');
    assert.equal(captured[0].extra?.status, 500);
  });
});

test('a safe 412 (an expected rejection, not a fault) is not reported', async () => {
  await withInitializedSentry(async (captured) => {
    await withFetch(
      async () => jsonResponse(412, { error: { message: 'This restaurant is paused right now.' } }),
      async () => {
        const failure = await callBackendRpc(stubSupabase(), ENV, 'customerSubmitOrderRating', {})
          .then(() => null)
          .catch((error: unknown) => error);

        assert.ok(isBackendRpcError(failure));
        assert.equal(failure.status, 412);
      }
    );

    assert.equal(captured.length, 0, 'a safe-text 4xx is an expected rejection, not a fault');
  });
});

test('a relay transport failure gets name NetworkError and is reported', async () => {
  await withInitializedSentry(async (captured) => {
    // FunctionsFetchError is exactly what @supabase/supabase-js constructs
    // when the SDK's own fetch call throws (e.g. a TypeError from a dropped
    // connection) -- the real-world origin of this case.
    const failure = await callBackendRpc(
      stubSupabaseWithRelayError(new FunctionsFetchError({})),
      RELAY_ONLY_ENV,
      'customerSubmitOrderRating',
      {}
    )
      .then(() => null)
      .catch((error: unknown) => error);

    assert.ok(failure instanceof Error);
    assert.equal(failure.name, 'NetworkError');
    assert.equal(captured.length, 1, 'a transport failure must be reported');
    assert.equal(captured[0].extra?.status, undefined, 'not a BackendRpcError, so no status');
  });
});

test('a direct-URL transport failure falls back to the relay, and when the relay also fails, it is reported exactly once', async () => {
  await withInitializedSentry(async (captured) => {
    await withFetch(
      // The direct-URL fetch itself throws -- caught by the `.catch` inside
      // `callViaDirectUrl`, tagged `NetworkError`, then swallowed by the
      // outer retry-on-transport-failure catch (only a `console.warn`),
      // which falls through to the relay below. Only the relay's failure
      // should escape `callBackendRpc` and be reported.
      async () => {
        throw new TypeError('Failed to fetch');
      },
      async () => {
        const failure = await callBackendRpc(
          stubSupabaseWithRelayError(new Error('relay is also down')),
          ENV,
          'customerSubmitOrderRating',
          {}
        )
          .then(() => null)
          .catch((error: unknown) => error);

        assert.ok(failure instanceof Error);
        assert.equal(failure.name, 'NetworkError');
      }
    );

    assert.equal(
      captured.length,
      1,
      'a direct-URL failure followed by a relay failure is still exactly one failed call, reported once'
    );
  });
});
