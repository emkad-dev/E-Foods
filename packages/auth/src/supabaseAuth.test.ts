/**
 * Run with: node --test packages/auth/src/supabaseAuth.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserWithEmail, isNetworkRequestError } from './supabaseAuth.ts';

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

test('createUserWithEmail sends the sign-up confirmation with the calling app own redirect URL', async () => {
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

  await createUserWithEmail(
    supabase,
    'new-user@example.com',
    'correct-horse-battery-staple',
    { display_name: 'New User' },
    { url: 'https://app.feasty.com.ng/verify-email' }
  );

  assert.equal(signUpCalls.length, 1);
  assert.equal(signUpCalls[0].options.emailRedirectTo, 'https://app.feasty.com.ng/verify-email');
  assert.deepEqual(signUpCalls[0].options.data, { display_name: 'New User' });
});

test('createUserWithEmail retries without the redirect when the project rejects it', async () => {
  const signUpCalls: any[] = [];
  const supabase = {
    auth: {
      signUp: async (payload: any) => {
        signUpCalls.push(payload);

        if (signUpCalls.length === 1) {
          return { data: { user: null, session: null }, error: { code: 'redirect_to_not_allowed' } };
        }

        return {
          data: { user: { id: 'user-123', email: 'new-user@example.com' }, session: null },
          error: null,
        };
      },
    },
  } as any;

  const result = await createUserWithEmail(
    supabase,
    'new-user@example.com',
    'correct-horse-battery-staple',
    { display_name: 'New User' },
    { url: 'https://app.feasty.com.ng/verify-email' }
  );

  assert.equal(signUpCalls.length, 2);
  assert.equal(signUpCalls[1].options.emailRedirectTo, undefined);
  assert.deepEqual(signUpCalls[1].options.data, { display_name: 'New User' });
  assert.equal(result.user.id, 'user-123');
});

test('isNetworkRequestError detects common browser and React Native fetch failures', () => {
  assert.equal(isNetworkRequestError(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkRequestError(new Error('Network request failed')), true);
  assert.equal(isNetworkRequestError(new Error('Something else broke')), false);
});
