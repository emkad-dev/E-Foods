import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeDelivery } from './orderDelivery.ts';

test('a pickup order has no courier, and says so', () => {
  assert.deepEqual(describeDelivery({ fulfillmentType: 'pickup' }), {
    mode: 'pickup',
    deliveredBy: 'Customer pickup, no courier',
    courier: null,
  });
});

test("a delivery with no FEASTY rider is the restaurant's own", () => {
  // Every delivered order in production looks like this (restaurants deliver
  // their own orders), which is why the old Courier field sat blank.
  assert.deepEqual(describeDelivery({ fulfillmentType: 'delivery', pricing: {}, assignment: null }), {
    mode: 'restaurant',
    deliveredBy: "The restaurant's own delivery",
    courier: null,
  });
});

test('a FEASTY delivery names the rider, or says none is assigned yet', () => {
  assert.deepEqual(
    describeDelivery({
      fulfillmentType: 'delivery',
      pricing: { deliveryProvider: 'platform' },
      assignment: { courierName: 'Tunde Adeyemi', courierId: 'uid-abc123' },
    }),
    { mode: 'platform', deliveredBy: 'FEASTY rider', courier: 'Tunde Adeyemi' }
  );
  assert.deepEqual(describeDelivery({ fulfillmentType: 'delivery', pricing: { deliveryProvider: 'platform' } }), {
    mode: 'platform',
    deliveredBy: 'FEASTY rider, not assigned yet',
    courier: null,
  });
});

test('a rider assignment counts as FEASTY delivery even without the pricing flag', () => {
  const result = describeDelivery({ fulfillmentType: 'delivery', assignment: { courierName: null, courierId: 'rider-9f8e7d' } });
  assert.equal(result.mode, 'platform');
  assert.equal(result.courier, '9F8E7D');
});
