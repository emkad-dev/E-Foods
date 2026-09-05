/**
 * Run with: node --test --experimental-strip-types packages/auth/src/authLoadingGuard.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldShowSignInLoading } from './authLoadingGuard.ts';

test('first sign-in (no prior user) shows loading', () => {
  assert.equal(
    shouldShowSignInLoading({
      event: 'SIGNED_IN',
      hasUser: false,
    }),
    true
  );
});

test('SIGNED_IN with a user already present (tab-refocus rehydration) does not show loading', () => {
  assert.equal(
    shouldShowSignInLoading({
      event: 'SIGNED_IN',
      hasUser: true,
    }),
    false
  );
});

test('sign-out then sign-in shows loading again', () => {
  // Simulates the ref transition a real context makes across two events:
  // SIGNED_IN while signed in (rehydration, no loading) -> SIGNED_OUT clears
  // the user -> a fresh interactive SIGNED_IN must show loading again.
  assert.equal(
    shouldShowSignInLoading({
      event: 'SIGNED_IN',
      hasUser: true,
    }),
    false,
    'sanity check: still signed in beforehand'
  );

  assert.equal(
    shouldShowSignInLoading({
      event: 'SIGNED_OUT',
      hasUser: true,
    }),
    false,
    'SIGNED_OUT itself never shows the sign-in loading state'
  );

  // After SIGNED_OUT resolves, the context's hasUserRef flips to false.
  assert.equal(
    shouldShowSignInLoading({
      event: 'SIGNED_IN',
      hasUser: false,
    }),
    true,
    'a fresh sign-in after sign-out shows loading'
  );
});

test('token refresh does not show loading', () => {
  assert.equal(
    shouldShowSignInLoading({
      event: 'TOKEN_REFRESHED',
      hasUser: true,
    }),
    false
  );

  assert.equal(
    shouldShowSignInLoading({
      event: 'TOKEN_REFRESHED',
      hasUser: false,
    }),
    false,
    'even with no prior user, a token refresh alone is not an interactive sign-in'
  );
});

test('other background reconciliation events never show loading', () => {
  const backgroundEvents = [
    'INITIAL_SESSION',
    'USER_UPDATED',
    'PASSWORD_RECOVERY',
    'MFA_CHALLENGE_VERIFIED',
  ] as const;

  for (const event of backgroundEvents) {
    assert.equal(shouldShowSignInLoading({ event, hasUser: false }), false, `${event} with no prior user`);
    assert.equal(shouldShowSignInLoading({ event, hasUser: true }), false, `${event} with a prior user`);
  }
});
