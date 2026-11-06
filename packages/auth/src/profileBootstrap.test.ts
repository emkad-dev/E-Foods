/**
 * Run with: node --test --experimental-strip-types packages/auth/src/profileBootstrap.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FunctionsFetchError } from '@supabase/supabase-js';
import { BackendRpcError, callBackendRpc } from './backendRpc.ts';
import { fetchProfileBootstrap } from './profileBootstrap.ts';
import { isTransientNetworkFailure } from './transientNetworkFailure.ts';

const ROW = {
  uid: 'u1',
  email: 'rider@example.com',
  role: 'customer',
  emailVerified: true,
  dispatchApplicationStatus: 'pending',
  activeSessionId: 'device-1',
};

const callReturning = (outcomes: Array<() => unknown>) => {
  const actions: string[] = [];
  const call = async <T>(action: string): Promise<T> => {
    actions.push(action);
    const outcome = outcomes[Math.min(actions.length - 1, outcomes.length - 1)];
    return outcome() as T;
  };
  return { call, actions };
};

test('maps the returned row through the same mapper as the direct profile read', async () => {
  const { call, actions } = callReturning([() => ({ profile: ROW })]);

  const result = await fetchProfileBootstrap(call, 'dispatchBootstrap');

  assert.deepEqual(actions, ['dispatchBootstrap']);
  assert.equal(result?.profile?.uid, 'u1');
  assert.equal(result?.profile?.emailVerified, true);
  assert.equal(result?.profile?.dispatchApplicationStatus, 'pending');
  // The mapper fills the shape the app expects, not the raw row.
  assert.equal(result?.profile?.activeSessionId, 'device-1');
  assert.equal(result?.profile?.accountDisabled, false);
  assert.equal(result?.profile?.partnerPayout, null);
});

test('an account with no profile row yet is a bootstrap with a null profile, not an unavailable one', async () => {
  const { call } = callReturning([() => ({ profile: null })]);

  assert.deepEqual(await fetchProfileBootstrap(call, 'partnerBootstrap'), { profile: null });
});

test('falls back (null) when the deployed backend does not implement the action', async () => {
  for (const status of [501, 404]) {
    const { call, actions } = callReturning([
      () => {
        throw new BackendRpcError('not implemented', { status });
      },
    ]);

    assert.equal(await fetchProfileBootstrap(call, 'partnerBootstrap'), null, `HTTP ${status}`);
    // An answer is not retried.
    assert.equal(actions.length, 1);
  }
});

test('a real server error propagates after one attempt rather than reading as "not deployed"', async () => {
  const { call, actions } = callReturning([
    () => {
      throw new BackendRpcError('boom', { status: 500 });
    },
  ]);

  await assert.rejects(() => fetchProfileBootstrap(call, 'dispatchBootstrap'), /boom/);
  assert.equal(actions.length, 1);
});

// ---- Through the REAL callBackendRpc ---------------------------------------
// The tests above hand-write the errors; these drive the real transport with a
// failing fetch and relay, so they see exactly what it throws.

const ENV = {
  backendRpcUrl: 'https://example.supabase.co/functions/v1/app-rpc',
  anonKey: 'anon-key',
  supabaseUrl: 'https://example.supabase.co',
};

const stubSupabase = (invoke: () => Promise<{ data: unknown; error: unknown }>) =>
  ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    },
    functions: { invoke },
  }) as never;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Replaces global fetch (and silences the transport's expected console.warn) for one run. */
const withTransport = async (impl: typeof fetch, run: () => Promise<void>) => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  globalThis.fetch = impl;
  console.warn = () => undefined;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
};

const realCall =
  (supabase: never, deadlineMs?: number) =>
  <T>(action: string) =>
    callBackendRpc<T>(supabase, ENV, action, undefined, deadlineMs === undefined ? undefined : { deadlineMs });

const relayFetchFailure = () => ({
  data: null,
  error: new FunctionsFetchError(new Error('Failed to send a request to the Edge Function')),
});

test('a real transport failure (fetch and relay both down) is retried once and the second answer is used', async () => {
  let fetchCalls = 0;
  let relayCalls = 0;
  const supabase = stubSupabase(async () => {
    relayCalls += 1;
    return relayFetchFailure();
  });

  await withTransport(
    (async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        throw new TypeError('Network request failed');
      }
      return jsonResponse(200, { data: { profile: ROW } });
    }) as typeof fetch,
    async () => {
      const result = await fetchProfileBootstrap(realCall(supabase), 'dispatchBootstrap');

      assert.equal(result?.profile?.uid, 'u1');
      assert.equal(fetchCalls, 2, 'one direct call per attempt');
      assert.equal(relayCalls, 1, 'the first attempt fell through to the relay, which also failed');
    }
  );
});

test('the failure the real transport throws is classified as transient, so the retry can fire at all', async () => {
  const supabase = stubSupabase(async () => relayFetchFailure());
  let thrown: unknown;

  await withTransport(
    (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch,
    async () => {
      thrown = await realCall(supabase)('dispatchBootstrap').catch((error) => error);
    }
  );

  assert.equal((thrown as Error).name, 'NetworkError');
  assert.equal(isTransientNetworkFailure(thrown), true);
});

test('a server answer is never retried, even when its message mentions a timeout', async () => {
  let fetchCalls = 0;
  const supabase = stubSupabase(async () => relayFetchFailure());

  await withTransport(
    (async () => {
      fetchCalls += 1;
      return jsonResponse(500, { error: { message: 'Upstream timeout while reading the profile' } });
    }) as typeof fetch,
    async () => {
      await assert.rejects(() => fetchProfileBootstrap(realCall(supabase), 'dispatchBootstrap'), /timeout/);
      assert.equal(fetchCalls, 1);
    }
  );
});

test('a stalled bootstrap (neither fetch nor relay settles) hits the deadline, is retried once, then rejects as a timeout', async () => {
  let fetchCalls = 0;
  const supabase = stubSupabase(() => new Promise(() => undefined));

  await withTransport(
    (() => {
      fetchCalls += 1;
      return new Promise(() => undefined); // ignores the abort signal entirely
    }) as typeof fetch,
    async () => {
      await assert.rejects(() => fetchProfileBootstrap(realCall(supabase, 25), 'dispatchBootstrap'), /timed out/);
      assert.equal(fetchCalls, 2, 'the deadline is a transient failure: exactly one retry');
    }
  );
});

test('a stalled first attempt followed by an answer completes sign-in instead of hanging', async () => {
  let fetchCalls = 0;
  const supabase = stubSupabase(() => new Promise(() => undefined));

  await withTransport(
    (() => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? new Promise(() => undefined)
        : Promise.resolve(jsonResponse(200, { data: { profile: ROW } }));
    }) as typeof fetch,
    async () => {
      const result = await fetchProfileBootstrap(realCall(supabase, 25), 'partnerBootstrap');

      assert.equal(result?.profile?.uid, 'u1');
      assert.equal(fetchCalls, 2);
    }
  );
});

test('when the deadline fires the relay is not started for a call nobody is waiting on', async () => {
  let relayCalls = 0;
  const supabase = stubSupabase(async () => {
    relayCalls += 1;
    return relayFetchFailure();
  });

  await withTransport(
    ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        // A fetch that honours the abort, as the real one does.
        init?.signal?.addEventListener('abort', () => reject(new TypeError('Network request failed')));
      })) as typeof fetch,
    async () => {
      await assert.rejects(() => realCall(supabase, 20)('dispatchBootstrap'), /timed out/);
      await new Promise((resolve) => setTimeout(resolve, 30));

      assert.equal(relayCalls, 0);
    }
  );
});

test('without a deadline the transport is exactly as before: no abort signal, no timer', async () => {
  let sawSignal: unknown = 'unset';
  const supabase = stubSupabase(async () => relayFetchFailure());

  await withTransport(
    ((_input: unknown, init?: { signal?: AbortSignal }) => {
      sawSignal = init?.signal;
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    }) as typeof fetch,
    async () => {
      const result = await realCall(supabase)('placeCustomerOrder');

      assert.deepEqual(result, { ok: true });
      assert.equal(sawSignal, undefined);
    }
  );
});
