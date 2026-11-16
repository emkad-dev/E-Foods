/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/paymentCallbackOrder.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findOrderIdForPaymentReference } from './paymentCallbackOrder.ts';

const REF = 'FEASTY-BNK-BA8F6F95-1794853487280';

test('finds the order whose payment reference matches', () => {
  const orders = [
    { id: 'order-a', payment: { reference: 'FEASTY-CRD-OTHER-1' } },
    { id: 'order-b', payment: { reference: REF } },
  ];
  assert.equal(findOrderIdForPaymentReference(orders, REF), 'order-b');
});

test('trims the returned reference before matching', () => {
  assert.equal(findOrderIdForPaymentReference([{ id: 'order-b', payment: { reference: REF } }], `  ${REF} `), 'order-b');
});

test('no match, no reference, or no orders gives an empty id', () => {
  const orders = [{ id: 'order-a', payment: { reference: 'FEASTY-CRD-OTHER-1' } }];
  assert.equal(findOrderIdForPaymentReference(orders, REF), '');
  assert.equal(findOrderIdForPaymentReference(orders, ''), '');
  assert.equal(findOrderIdForPaymentReference([], REF), '');
  assert.equal(findOrderIdForPaymentReference(null, REF), '');
});

test('orders without a payment or reference are skipped, not matched on empty', () => {
  const orders = [
    { id: 'order-a', payment: null },
    { id: 'order-b' },
    { id: 'order-c', payment: { reference: null } },
  ];
  assert.equal(findOrderIdForPaymentReference(orders, REF), '');
});

test('a grouped checkout opens the primary order (the one whose id is the group id)', () => {
  const orders = [
    { id: 'member-2', orderGroupId: 'primary-1', payment: { reference: REF } },
    { id: 'primary-1', orderGroupId: 'primary-1', payment: { reference: REF } },
  ];
  assert.equal(findOrderIdForPaymentReference(orders, REF), 'primary-1');
});

test('without a primary among the matches, the first match is used', () => {
  const orders = [
    { id: 'member-2', orderGroupId: 'primary-1', payment: { reference: REF } },
    { id: 'member-3', orderGroupId: 'primary-1', payment: { reference: REF } },
  ];
  assert.equal(findOrderIdForPaymentReference(orders, REF), 'member-2');
});
