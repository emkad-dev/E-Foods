/**
 * Run with: node --test --experimental-strip-types packages/auth/src/transientNetworkFailure.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isTransientNetworkFailure,
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
