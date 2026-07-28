/**
 * Run with: node --test --experimental-strip-types apps/partner/src/services/restaurantCompletionHandoff.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RESTAURANT_ACCESS_TIMEOUT_MESSAGE,
  RESTAURANT_ACCESS_WAITING_MESSAGE,
  runRestaurantCompletionHandoff,
} from './restaurantCompletionHandoff.js';

test('waits for the restaurant role and restaurant link to land before navigating', async () => {
  let now = 0;
  let refreshCalls = 0;
  let submitCalls = 0;
  let navigationCalls = 0;
  let userIndex = 0;
  let sawRestaurantState = false;

  const users = [
    { restaurantId: null, role: 'customer' },
    { restaurantId: 'restaurant-999', role: 'restaurant' },
    { restaurantId: 'restaurant-123', role: 'restaurant' },
  ];

  const result = await runRestaurantCompletionHandoff({
    getCurrentUser: () => {
      const currentUser = users[Math.min(userIndex, users.length - 1)] ?? null;

      if (currentUser?.role === 'restaurant') {
        sawRestaurantState = true;
      }

      return currentUser;
    },
    now: () => now,
    onReady: async () => {
      navigationCalls += 1;
      assert.equal(sawRestaurantState, true);
    },
    pollIntervalMs: 50,
    refreshAuthSession: async () => {
      refreshCalls += 1;
    },
    sleep: async (milliseconds) => {
      now += milliseconds;
      userIndex += 1;
    },
    submitApplication: async () => {
      submitCalls += 1;
      return {
        restaurantId: 'restaurant-123',
        submittedAt: '2026-07-25T08:00:00.000Z',
        targetUid: 'user-123',
      };
    },
    timeoutMs: 500,
  });

  assert.equal(submitCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(navigationCalls, 1);
  assert.equal(result.kind, 'ready');
  assert.equal(result.application.restaurantId, 'restaurant-123');
  assert.equal(RESTAURANT_ACCESS_WAITING_MESSAGE, 'Waiting for restaurant access to sync...');
});

test('times out loudly when the auth user never becomes restaurant', async () => {
  let now = 0;
  let refreshCalls = 0;
  let submitCalls = 0;
  let navigationCalls = 0;

  const result = await runRestaurantCompletionHandoff({
    getCurrentUser: () => ({
      restaurantId: null,
      role: 'customer',
    }),
    now: () => now,
    onReady: async () => {
      navigationCalls += 1;
    },
    pollIntervalMs: 50,
    refreshAuthSession: async () => {
      refreshCalls += 1;
    },
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
    submitApplication: async () => {
      submitCalls += 1;
      return {
        restaurantId: 'restaurant-123',
        submittedAt: '2026-07-25T08:00:00.000Z',
        targetUid: 'user-123',
      };
    },
    timeoutMs: 150,
  });

  assert.equal(submitCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(navigationCalls, 0);
  assert.equal(result.kind, 'timeout');
  assert.equal(result.application.restaurantId, 'restaurant-123');
  assert.equal(RESTAURANT_ACCESS_TIMEOUT_MESSAGE, 'Your details were saved, but restaurant access has not synced yet. Sign out and sign back in, then tap "Check access again".');
});
