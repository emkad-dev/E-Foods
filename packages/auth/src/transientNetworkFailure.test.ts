/**
 * Run with: node --test --experimental-strip-types packages/auth/src/transientNetworkFailure.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isTransientNetworkFailure,
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
// stored session is still there; only a SIGNED_OUT (or a lookup that finds
// nothing and no error) means the user is really signed out.
const clientWhoseGetSession = (result: unknown) =>
  ({ auth: { getSession: async () => result } }) as any;

test('offline INITIAL_SESSION with no session is not a sign-out', async () => {
  const supabase = clientWhoseGetSession({
    data: { session: null },
    error: new TypeError('Network request failed'),
  });
  assert.equal(await resolveNullSessionOutcome(supabase, 'INITIAL_SESSION'), 'offline');
});

test('a timed-out refresh on INITIAL_SESSION is offline too, and a throwing lookup counts as its error', async () => {
  assert.equal(
    await resolveNullSessionOutcome(
      clientWhoseGetSession({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Aborted' } }),
      'INITIAL_SESSION'
    ),
    'offline'
  );
  const throwing = {
    auth: {
      getSession: async () => {
        throw new TypeError('Failed to fetch');
      },
    },
  } as any;
  assert.equal(await resolveNullSessionOutcome(throwing, 'INITIAL_SESSION'), 'offline');
});

test('INITIAL_SESSION with no stored session and no error is a real signed-out state', async () => {
  const supabase = clientWhoseGetSession({ data: { session: null }, error: null });
  assert.equal(await resolveNullSessionOutcome(supabase, 'INITIAL_SESSION'), 'signed-out');
});

test('a dead refresh token is signed out, not offline', async () => {
  const supabase = clientWhoseGetSession({
    data: { session: null },
    error: { name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found' },
  });
  assert.equal(await resolveNullSessionOutcome(supabase, 'INITIAL_SESSION'), 'signed-out');
});

test('SIGNED_OUT is always signed out and never asks the client anything', async () => {
  const supabase = {
    auth: {
      getSession: async () => {
        throw new Error('must not be called');
      },
    },
  } as any;
  assert.equal(await resolveNullSessionOutcome(supabase, 'SIGNED_OUT'), 'signed-out');
});

test('if the lookup finds a session (network came back) the reconcile has nothing to do', async () => {
  const supabase = clientWhoseGetSession({ data: { session: { user: { id: 'u1' } } }, error: null });
  assert.equal(await resolveNullSessionOutcome(supabase, 'INITIAL_SESSION'), 'recovered');
});
