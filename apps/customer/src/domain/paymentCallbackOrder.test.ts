/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/paymentCallbackOrder.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PAYMENT_HANDOFF_STORAGE_KEY,
  acceptOrderIdParam,
  findOrderIdForPaymentReference,
  forgetPaymentHandoff,
  readPaymentHandoffOrderId,
  rememberPaymentHandoff,
} from './paymentCallbackOrder.ts';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};

const throwingStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

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

test('a remembered handoff gives back its orderId when the references agree', () => {
  const storage = memoryStorage();
  rememberPaymentHandoff(storage, { orderId: 'order-b', reference: REF });
  assert.equal(readPaymentHandoffOrderId(storage, REF), 'order-b');
});

test('a handoff from an earlier checkout (different reference) is ignored', () => {
  const storage = memoryStorage();
  rememberPaymentHandoff(storage, { orderId: 'old-order', reference: 'FEASTY-CRD-OLD-1' });
  assert.equal(readPaymentHandoffOrderId(storage, REF), '');
});

test('a handoff is used when the return carries no reference to compare', () => {
  const storage = memoryStorage();
  rememberPaymentHandoff(storage, { orderId: 'order-b', reference: REF });
  assert.equal(readPaymentHandoffOrderId(storage, ''), 'order-b');
});

test('nothing is remembered without an orderId, and forget clears it', () => {
  const storage = memoryStorage();
  rememberPaymentHandoff(storage, { orderId: '  ', reference: REF });
  assert.equal(storage.values.size, 0);
  rememberPaymentHandoff(storage, { orderId: 'order-b', reference: REF });
  forgetPaymentHandoff(storage);
  assert.equal(readPaymentHandoffOrderId(storage, REF), '');
});

test('corrupt stored values read as no handoff', () => {
  const storage = memoryStorage();
  storage.setItem(PAYMENT_HANDOFF_STORAGE_KEY, '{not json');
  assert.equal(readPaymentHandoffOrderId(storage, REF), '');
  storage.setItem(PAYMENT_HANDOFF_STORAGE_KEY, '"just a string"');
  assert.equal(readPaymentHandoffOrderId(storage, REF), '');
});

test('storage that throws, or no storage at all, never throws to the caller', () => {
  assert.doesNotThrow(() => rememberPaymentHandoff(throwingStorage, { orderId: 'order-b', reference: REF }));
  assert.doesNotThrow(() => forgetPaymentHandoff(throwingStorage));
  assert.equal(readPaymentHandoffOrderId(throwingStorage, REF), '');
  assert.doesNotThrow(() => rememberPaymentHandoff(null, { orderId: 'order-b', reference: REF }));
  assert.equal(readPaymentHandoffOrderId(null, REF), '');
});

test('only a UUID-shaped orderId param is accepted', () => {
  assert.equal(acceptOrderIdParam('5e1dc1d4-44a8-449e-a895-998fba8f6f95'), '5e1dc1d4-44a8-449e-a895-998fba8f6f95');
  assert.equal(acceptOrderIdParam(' 5E1DC1D4-44A8-449E-A895-998FBA8F6F95 '), '5E1DC1D4-44A8-449E-A895-998FBA8F6F95');
  assert.equal(acceptOrderIdParam('undefined'), '');
  assert.equal(acceptOrderIdParam('5e1dc1d4-44a8-449e-a895'), '');
  assert.equal(acceptOrderIdParam('5e1dc1d4-44a8-449e-a895-998fba8f6f95/../x'), '');
  assert.equal(acceptOrderIdParam(''), '');
  assert.equal(acceptOrderIdParam(undefined), '');
});
