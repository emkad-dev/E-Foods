/**
 * Run with: node --test packages/auth/src/cacheHydration.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldHydrateCachedUserProfile } from './cacheHydration.ts';

test('cached users are only hydrated when the Supabase session user matches the cache', () => {
  assert.equal(
    shouldHydrateCachedUserProfile({
      sessionUserId: 'user-123',
      cachedUser: {
        uid: 'user-123',
        role: 'customer',
      },
      expectedRole: 'customer',
    }),
    true
  );

  assert.equal(
    shouldHydrateCachedUserProfile({
      sessionUserId: null,
      cachedUser: {
        uid: 'user-123',
        role: 'customer',
      },
      expectedRole: 'customer',
    }),
    false
  );

  assert.equal(
    shouldHydrateCachedUserProfile({
      sessionUserId: 'user-123',
      cachedUser: {
        uid: 'user-456',
        role: 'customer',
      },
      expectedRole: 'customer',
    }),
    false
  );
});
