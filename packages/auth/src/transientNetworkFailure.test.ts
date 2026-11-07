/**
 * Run with: node --test --experimental-strip-types packages/auth/src/transientNetworkFailure.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isTransientNetworkFailure,
  retryOnceOnTransientFailure,
  resolveNullSessionOutcome,
  resolveProfileLoadFailure,
} from './transientNetworkFailure.ts';

test('treats the failures a dropped or stalled connection really produces as transient', () => {
  // The two the apps used to miss: only "offline" counted before.
  assert.equal(isTransientNetworkFailure(new TypeError('Network request failed')), true);
  assert.equal(isTransientNetworkFailure(new TypeError('Failed to fetch')), true);
  // boundedFetch aborts after 15s; the message differs by runtime and by who wraps it.
  assert.equal(isTransientNetworkFailure(new DOMException('The operation was aborted.', 'AbortError')), true);
  assert.equal(isTransientNetworkFailure(new Error('Aborted')), true);
  assert.equal(isTransientNetworkFailure({ message: 'AbortError: signal is aborted without reason' }), true);
  assert.equal(isTransientNetworkFailure({ name: 'AuthRetryableFetchError', message: 'x', status: 0 }), true);
  // The pre-existing "offline" recognition is kept.
  assert.equal(isTransientNetworkFailure({ code: 'unavailable', message: 'x' }), true);
  assert.equal(isTransientNetworkFailure({ code: 'failed-precondition', message: 'x' }), true);
  assert.equal(isTransientNetworkFailure(new Error('Client is offline')), true);
});

test('does not treat real rejections as transient', () => {
  assert.equal(isTransientNetworkFailure(new Error('Invalid login credentials')), false);
  assert.equal(isTransientNetworkFailure({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isTransientNetworkFailure(new Error('Invalid Refresh Token: Refresh Token Not Found')), false);
  assert.equal(isTransientNetworkFailure(null), false);
  assert.equal(isTransientNetworkFailure(undefined), false);
});

test('a transient failure with a saved profile for the same user keeps them signed in', () => {
  assert.equal(
    resolveProfileLoadFailure({
      error: new TypeError('Network request failed'),
      hasAuthUser: true,
      hasUsableCachedProfile: true,
    }),
    'keep-cached-user'
  );
});

test('a transient failure with no usable saved profile shows no-internet and keeps the session', () => {
  assert.equal(
    resolveProfileLoadFailure({
      error: new TypeError('Network request failed'),
      hasAuthUser: true,
      hasUsableCachedProfile: false,
    }),
    'offline-without-profile'
  );
});

test('anything else, or no auth user, is a genuine failure', () => {
  assert.equal(
    resolveProfileLoadFailure({
      error: new Error('permission denied'),
      hasAuthUser: true,
      hasUsableCachedProfile: true,
    }),
    'fail'
  );
  assert.equal(
    resolveProfileLoadFailure({
      error: new TypeError('Network request failed'),
      hasAuthUser: false,
      hasUsableCachedProfile: true,
    }),
    'fail'
  );
});

// supabase-js delivers INITIAL_SESSION with a null session when the stored
// session's refresh fails -- including when the phone is simply offline. The
// stored session is still there (auth-js removes it only on a NON-retryable
// refresh error), so the stored session itself is the signal. Reading storage
// never blocks: a second getSession() would queue behind the auth lock for as
// long as the device is offline.
const clientWithStorage = (stored: boolean) =>
  ({
    auth: {
      storageKey: 'sb-abcdefgh-auth-token',
      storage: {
        getItem: async () => (stored ? '{"refresh_token":"r"}' : null),
      },
    },
  }) as any;

test('INITIAL_SESSION with no session but a stored one is offline, not a sign-out', async () => {
  assert.equal(await resolveNullSessionOutcome(clientWithStorage(true), 'INITIAL_SESSION'), 'offline');
});

test('INITIAL_SESSION with nothing stored is a real signed-out state (also what a dead refresh token leaves)', async () => {
  assert.equal(await resolveNullSessionOutcome(clientWithStorage(false), 'INITIAL_SESSION'), 'signed-out');
});

test('SIGNED_OUT is always signed out and never reads storage', async () => {
  const supabase = {
    auth: {
      storageKey: 'k',
      storage: {
        getItem: async () => {
          throw new Error('must not be called');
        },
      },
    },
  } as any;
  assert.equal(await resolveNullSessionOutcome(supabase, 'SIGNED_OUT'), 'signed-out');
});

test('unreadable storage falls back to signed out', async () => {
  const supabase = {
    auth: {
      storageKey: 'k',
      storage: {
        getItem: async () => {
          throw new Error('storage broke');
        },
      },
    },
  } as any;
  assert.equal(await resolveNullSessionOutcome(supabase, 'INITIAL_SESSION'), 'signed-out');
});

test('the web lock execution timeout counts as transient (boundedNavigatorLock, 50s)', () => {
  assert.equal(
    isTransientNetworkFailure(new Error('Supabase auth lock "lock:sb-abc-auth-token" did not resolve within 50000ms.')),
    true
  );
});

test('retryOnceOnTransientFailure runs the operation again after a transient failure and returns the second result', async () => {
  let calls = 0;
  const result = await retryOnceOnTransientFailure(async () => {
    calls += 1;
    if (calls === 1) {
      throw new TypeError('Network request failed');
    }
    return 'second';
  });

  assert.equal(result, 'second');
  assert.equal(calls, 2);
});

test('retryOnceOnTransientFailure retries at most once', async () => {
  let calls = 0;
  await assert.rejects(
    retryOnceOnTransientFailure(async () => {
      calls += 1;
      throw new TypeError('Failed to fetch');
    }),
    /Failed to fetch/
  );

  assert.equal(calls, 2);
});

test('retryOnceOnTransientFailure does not retry a real rejection', async () => {
  let calls = 0;
  await assert.rejects(
    retryOnceOnTransientFailure(async () => {
      calls += 1;
      throw new Error('permission denied');
    }),
    /permission denied/
  );

  assert.equal(calls, 1);
});

test("the transport's own NetworkError and TimeoutError are transient, whatever their wording", () => {
  assert.equal(
    isTransientNetworkFailure(
      Object.assign(new Error('Backend RPC x failed: Failed to send a request to the Edge Function'), { name: 'NetworkError' })
    ),
    true
  );
  assert.equal(
    isTransientNetworkFailure(Object.assign(new Error('Backend RPC x ran out of time.'), { name: 'TimeoutError' })),
    true
  );
});

test('retryOnceOnTransientFailure never retries a server answer, even one whose message reads like a timeout', async () => {
  let calls = 0;
  await assert.rejects(
    retryOnceOnTransientFailure(async () => {
      calls += 1;
      throw Object.assign(new Error('Upstream timeout while reading the profile'), { name: 'BackendRpcError', status: 504 });
    }),
    /Upstream timeout/
  );

  assert.equal(calls, 1);
});
