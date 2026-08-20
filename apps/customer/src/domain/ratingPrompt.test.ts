/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/ratingPrompt.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALREADY_RATED_MESSAGE,
  isAlreadyRatedError,
  isValidScore,
  selectNextPendingRating,
  type PendingRating,
} from './ratingPrompt.ts';

const pendingRating = (overrides: Partial<PendingRating> = {}): PendingRating => ({
  deliveredAt: '2026-08-19T10:00:00.000Z',
  hasCourier: true,
  orderId: 'order-1',
  restaurantId: 'restaurant-1',
  restaurantName: 'Test Kitchen',
  ...overrides,
});

// --- selectNextPendingRating -----------------------------------------------

test('selectNextPendingRating: a delivered-but-unrated order surfaces a pending rating', () => {
  const order = pendingRating();
  assert.equal(selectNextPendingRating([order], new Set()), order);
});

test('selectNextPendingRating: a rated order never appears in the list at all, so nothing surfaces', () => {
  // customerGetPendingRatings already excludes a rated order server-side —
  // the client-side list it receives is simply empty for that order.
  assert.equal(selectNextPendingRating([], new Set()), null);
});

test('selectNextPendingRating: an order just submitted this session does not re-appear, even though the server list has not caught up yet', () => {
  const order = pendingRating();
  // The server's `pending` list can still list the order for a moment after
  // a successful submit (the next customerGetPendingRatings fetch hasn't run
  // yet) — the local handled-set is what prevents the prompt flashing again.
  assert.equal(selectNextPendingRating([order], new Set([order.orderId])), null);
});

test('selectNextPendingRating: with several pending, the first unhandled one is selected, in list order', () => {
  const first = pendingRating({ orderId: 'order-1' });
  const second = pendingRating({ orderId: 'order-2' });
  const third = pendingRating({ orderId: 'order-3' });

  assert.equal(selectNextPendingRating([first, second, third], new Set()), first);
  assert.equal(selectNextPendingRating([first, second, third], new Set(['order-1'])), second);
  assert.equal(selectNextPendingRating([first, second, third], new Set(['order-1', 'order-2'])), third);
  assert.equal(selectNextPendingRating([first, second, third], new Set(['order-1', 'order-2', 'order-3'])), null);
});

// --- isAlreadyRatedError: handled cleanly, without an error banner ---------

test('isAlreadyRatedError: the exact already_rated message is recognized', () => {
  assert.equal(isAlreadyRatedError(new Error(ALREADY_RATED_MESSAGE)), true);
});

test('isAlreadyRatedError: a DIFFERENT server rejection is NOT treated as already-rated — it must still surface as a real error', () => {
  assert.equal(isAlreadyRatedError(new Error('You can only rate your own orders.')), false);
  assert.equal(isAlreadyRatedError(new Error('Only a delivered order can be rated.')), false);
  assert.equal(isAlreadyRatedError(new Error('A restaurant rating between 1 and 5 is required.')), false);
});

test('isAlreadyRatedError: a network/infra failure is not swallowed either', () => {
  assert.equal(isAlreadyRatedError(new Error('Backend RPC customerSubmitOrderRating failed to send request.')), false);
});

test('isAlreadyRatedError: a non-Error value is never treated as already-rated', () => {
  assert.equal(isAlreadyRatedError(ALREADY_RATED_MESSAGE), false);
  assert.equal(isAlreadyRatedError(null), false);
  assert.equal(isAlreadyRatedError(undefined), false);
});

// --- isValidScore ------------------------------------------------------

test('isValidScore: 1 through 5 are valid', () => {
  for (const score of [1, 2, 3, 4, 5]) {
    assert.equal(isValidScore(score), true, `${score} should be valid`);
  }
});

test('isValidScore: 0, 6, negative, non-integer, and non-number are rejected', () => {
  assert.equal(isValidScore(0), false);
  assert.equal(isValidScore(6), false);
  assert.equal(isValidScore(-1), false);
  assert.equal(isValidScore(3.5), false);
  assert.equal(isValidScore('5'), false);
  assert.equal(isValidScore(null), false);
  assert.equal(isValidScore(undefined), false);
});
