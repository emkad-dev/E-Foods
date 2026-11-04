/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/orderLoad.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldKeepOrderOnLoadFailure } from './orderLoad.ts';

const held = { customerId: 'customer-1', id: 'order-1' };

test('shouldKeepOrderOnLoadFailure: a failed reload keeps the order already held', () => {
  assert.equal(shouldKeepOrderOnLoadFailure(held, 'order-1', 'customer-1'), true);
});

test('shouldKeepOrderOnLoadFailure: a failed first load has nothing to keep', () => {
  assert.equal(shouldKeepOrderOnLoadFailure(null, 'order-1', 'customer-1'), false);
  assert.equal(shouldKeepOrderOnLoadFailure(undefined, 'order-1', 'customer-1'), false);
});

test('shouldKeepOrderOnLoadFailure: another order id never inherits the previous order', () => {
  assert.equal(shouldKeepOrderOnLoadFailure(held, 'order-2', 'customer-1'), false);
});

test('shouldKeepOrderOnLoadFailure: a different account never sees the previous account order', () => {
  // The screen can stay mounted through a sign-out/sign-in; if the new
  // account's reload fails, the old account's order must not remain.
  assert.equal(shouldKeepOrderOnLoadFailure(held, 'order-1', 'customer-2'), false);
  assert.equal(shouldKeepOrderOnLoadFailure(held, 'order-1', null), false);
  assert.equal(shouldKeepOrderOnLoadFailure({ id: 'order-1' }, 'order-1', 'customer-1'), false);
});

test('shouldKeepOrderOnLoadFailure: a held order with no id is not kept', () => {
  assert.equal(shouldKeepOrderOnLoadFailure({ customerId: 'customer-1' }, 'order-1', 'customer-1'), false);
  assert.equal(shouldKeepOrderOnLoadFailure({ customerId: 'customer-1', id: null }, '', 'customer-1'), false);
});
