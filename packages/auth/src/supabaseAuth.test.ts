/**
 * Run with: node --test packages/auth/src/supabaseAuth.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserWithEmail } from './supabaseAuth.ts';

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
