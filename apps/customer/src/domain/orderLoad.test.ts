/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/orderLoad.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldKeepOrderOnLoadFailure } from './orderLoad.ts';

test('shouldKeepOrderOnLoadFailure: a failed reload keeps the order already held', () => {
  assert.equal(shouldKeepOrderOnLoadFailure({ id: 'order-1' }, 'order-1'), true);
});

test('shouldKeepOrderOnLoadFailure: a failed first load has nothing to keep', () => {
  assert.equal(shouldKeepOrderOnLoadFailure(null, 'order-1'), false);
  assert.equal(shouldKeepOrderOnLoadFailure(undefined, 'order-1'), false);
});

test('shouldKeepOrderOnLoadFailure: another order id never inherits the previous order', () => {
  assert.equal(shouldKeepOrderOnLoadFailure({ id: 'order-1' }, 'order-2'), false);
});

test('shouldKeepOrderOnLoadFailure: a held order with no id is not kept', () => {
  assert.equal(shouldKeepOrderOnLoadFailure({}, 'order-1'), false);
  assert.equal(shouldKeepOrderOnLoadFailure({ id: null }, ''), false);
});
