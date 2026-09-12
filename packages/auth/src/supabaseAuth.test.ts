/**
 * Run with: node --test packages/auth/src/supabaseAuth.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_ALREADY_REGISTERED_MESSAGE,
  createUserWithEmail,
  formatAuthError,
  isNetworkRequestError,
  sendPasswordResetEmailWithFallback,
  sendVerificationEmailWithFallback,
  verifyPasswordResetOtp,
} from './supabaseAuth.ts';

const signUpStub = (user: unknown, session: unknown = null) =>
  ({
    auth: {
      signUp: async () => ({ data: { user, session }, error: null }),
    },
  }) as any;

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
    // No `identities` key at all — an unknown, which must NOT read as
    // already-registered. See the guard below.
    alreadyRegistered: false,
  });
  assert.equal(signInCalled, false);
});

/**
 * THE ALREADY-REGISTERED GATE.
 *
 * Supabase answers a sign-up for an address that already has an account with
 * HTTP 200 and an empty `identities` array — no error, and (for a confirmed
 * account) no email. That empty array is the ONLY signal the client gets, and it
 * used to be discarded here, so every register screen reported success and the
 * user waited forever for a code.
 */
test('createUserWithEmail flags a repeat sign-up from an empty identities array', async () => {
  const result = await createUserWithEmail(
    signUpStub({ id: 'user-123', email: 'taken@example.com', identities: [] }),
    'taken@example.com',
    'correct-horse-battery-staple'
  );

  assert.equal(result.alreadyRegistered, true);
  // Still a resolved call, not a throw: the raw signal belongs to the caller,
  // which decides how to phrase it.
  assert.equal(result.session, null);
});

test('createUserWithEmail does not flag a genuinely new sign-up', async () => {
  const withIdentity = await createUserWithEmail(
    signUpStub({ id: 'user-123', email: 'new@example.com', identities: [{ id: 'identity-1' }] }),
    'new@example.com',
    'correct-horse-battery-staple'
  );

  assert.equal(withIdentity.alreadyRegistered, false);
});

test('createUserWithEmail treats a missing or non-array identities field as unknown, not as already-registered', async () => {
  // A false positive here would tell every genuinely new user that their brand
  // new address was already taken — worse than the silence this branch fixes —
  // so anything that is not a real empty array must fall through.
  for (const identities of [undefined, null, 'not-an-array', 0, {}]) {
    const result = await createUserWithEmail(
      signUpStub({ id: 'user-123', email: 'new@example.com', identities }),
      'new@example.com',
      'correct-horse-battery-staple'
    );

    assert.equal(result.alreadyRegistered, false, `identities=${JSON.stringify(identities)} must not flag`);
  }
});

test('the already-registered message is true whether or not a confirmation email was just resent', () => {
  // Supabase resends the confirmation for an UNCONFIRMED existing user and sends
  // nothing for a CONFIRMED one, and both come back identically — so the inbox
  // half of the message has to stay conditional.
  assert.match(ACCOUNT_ALREADY_REGISTERED_MESSAGE, /already registered/);
  assert.match(ACCOUNT_ALREADY_REGISTERED_MESSAGE, /Sign in/);
  assert.match(ACCOUNT_ALREADY_REGISTERED_MESSAGE, /if you never confirmed it/);
  // It must never claim outright that a code was sent.
  assert.equal(/we(?:'ve| have)? (?:just )?sent/i.test(ACCOUNT_ALREADY_REGISTERED_MESSAGE), false);
});

test('an outright already-exists error code lands on the same message', () => {
  // Some project configurations return the error instead of the silent 200; the
  // register screens key their two follow-up links off this exact string.
  assert.equal(formatAuthError({ code: 'user_already_exists' }), ACCOUNT_ALREADY_REGISTERED_MESSAGE);
  assert.equal(formatAuthError({ code: 'email_exists' }), ACCOUNT_ALREADY_REGISTERED_MESSAGE);
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
