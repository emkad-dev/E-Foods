/**
 * Run with: node --test packages/auth/src/supabaseAuth.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUserWithEmail,
  isNetworkRequestError,
  sendPasswordResetEmailWithFallback,
  sendVerificationEmailWithFallback,
  verifyPasswordResetOtp,
} from './supabaseAuth.ts';

test('createUserWithEmail returns the Supabase session and does not fall back to password sign-in', async () => {
  let signInCalled = false;
  const supabase = {
    auth: {
      signUp: async () => ({
        data: {
          user: {
            id: 'user-123',
            email: 'new-user@example.com',
          },
          session: null,
        },
        error: null,
      }),
      signInWithPassword: async () => {
        signInCalled = true;
        throw new Error('signInWithPassword should not be called for a confirmation-on signup');
      },
    },
  } as any;

  const result = await createUserWithEmail(supabase, 'new-user@example.com', 'correct-horse-battery-staple', {
    displayName: 'New User',
  });

  assert.deepEqual(result, {
    user: {
      id: 'user-123',
      email: 'new-user@example.com',
    },
    session: null,
  });
  assert.equal(signInCalled, false);
});

/**
 * THE REGRESSION TEST FOR OTP-ONLY EMAIL CONFIRMATION.
 *
 * These three used to assert the OPPOSITE: that signUp/resend/reset carried
 * `emailRedirectTo` (or `redirectTo`) pointing at
 * `https://app.feasty.com.ng/verify-email`. They are inverted on purpose. A
 * redirect URL is only ever meaningful for a CLICKABLE link, so the way this
 * repo proves "the app never asks for a link" is to prove no redirect is ever
 * sent. If any of these three start failing, a link flow has come back.
 *
 * What they cannot prove: whether the email BODY is a code or a link. That is
 * the Supabase email template, which is dashboard-only and outside this repo.
 */
test('createUserWithEmail never sends a redirect (OTP-only confirmation)', async () => {
  const signUpCalls: any[] = [];
  const supabase = {
    auth: {
      signUp: async (payload: any) => {
        signUpCalls.push(payload);
        return {
          data: { user: { id: 'user-123', email: 'new-user@example.com' }, session: null },
          error: null,
        };
      },
    },
  } as any;

  await createUserWithEmail(supabase, 'new-user@example.com', 'correct-horse-battery-staple', {
    display_name: 'New User',
  });

  assert.equal(signUpCalls.length, 1);
  assert.equal(signUpCalls[0].options.emailRedirectTo, undefined);
  assert.equal(
    Object.prototype.hasOwnProperty.call(signUpCalls[0].options, 'emailRedirectTo'),
    false,
    'the key must be absent, not merely undefined'
  );
  assert.deepEqual(signUpCalls[0].options.data, { display_name: 'New User' });
});

test('sendVerificationEmailWithFallback never sends a redirect (OTP-only confirmation)', async () => {
  const resendCalls: any[] = [];
  const supabase = {
    auth: {
      resend: async (payload: any) => {
        resendCalls.push(payload);
        return { data: {}, error: null };
      },
    },
  } as any;

  await sendVerificationEmailWithFallback(supabase, 'new-user@example.com');

  assert.equal(resendCalls.length, 1);
  assert.deepEqual(resendCalls[0], { type: 'signup', email: 'new-user@example.com' });
  assert.equal(resendCalls[0].options, undefined);
});

test('sendPasswordResetEmailWithFallback never sends a redirect (OTP-only recovery)', async () => {
  const resetCalls: any[] = [];
  const supabase = {
    auth: {
      resetPasswordForEmail: async (...args: any[]) => {
        resetCalls.push(args);
        return { data: {}, error: null };
      },
    },
  } as any;

  await sendPasswordResetEmailWithFallback(supabase, 'new-user@example.com');

  assert.equal(resetCalls.length, 1);
  // One argument only: passing an options object at all is how a redirect used
  // to get in, so the absence of the second argument is the assertion.
  assert.deepEqual(resetCalls[0], ['new-user@example.com']);
});

test('verifyPasswordResetOtp redeems a trimmed recovery code and leaves the password to updateUser', async () => {
  const verifyCalls: any[] = [];
  const supabase = {
    auth: {
      verifyOtp: async (payload: any) => {
        verifyCalls.push(payload);
        return { data: { session: { access_token: 'recovery-session' } }, error: null };
      },
    },
  } as any;

  const data = await verifyPasswordResetOtp(supabase, 'new-user@example.com', '  123456 ');

  assert.deepEqual(verifyCalls, [
    { email: 'new-user@example.com', token: '123456', type: 'recovery' },
  ]);
  // Step one of the two-step contract: a session, not a password change.
  assert.equal((data as any).session.access_token, 'recovery-session');
});

test('verifyPasswordResetOtp throws the Supabase error for a bad code', async () => {
  const supabase = {
    auth: {
      verifyOtp: async () => ({ data: null, error: { code: 'otp_expired', message: 'Token has expired' } }),
    },
  } as any;

  await assert.rejects(
    () => verifyPasswordResetOtp(supabase, 'new-user@example.com', '000000'),
    (err: any) => err.code === 'otp_expired'
  );
});

test('isNetworkRequestError detects common browser and React Native fetch failures', () => {
  assert.equal(isNetworkRequestError(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkRequestError(new Error('Network request failed')), true);
  assert.equal(isNetworkRequestError(new Error('Something else broke')), false);
});
