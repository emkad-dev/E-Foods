/**
 * Run with: node --test --experimental-strip-types packages/domain/src/adminOrders.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canAdminForceCancelOrder,
  canAdminForceCompleteOrder,
  canAdminResolveOrderReport,
  restaurantOwedForOrder,
  selectAttentionOrders,
} from './adminOrders.ts';

test('attention orders are every flagged order, whatever the status', () => {
  const orders = [
    { id: 'a', status: 'cancelled', needsAttention: true },
    { id: 'b', status: 'rejected', needsAttention: true },
    { id: 'c', status: 'delivered', needsAttention: false },
    { id: 'd', status: 'placed', needsAttention: true },
    { id: 'e', status: 'failed_delivery', needsAttention: null },
    { id: 'f', status: 'delivered' },
  ];
  assert.deepEqual(
    selectAttentionOrders(orders).map((order) => order.id),
    ['a', 'b', 'd']
  );
});

test('force-cancel is offered for every status that has not ended', () => {
  for (const status of ['scheduled', 'placed', 'accepted', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way', 'escalated']) {
    assert.equal(canAdminForceCancelOrder({ status }), true, status);
  }
  for (const status of ['delivered', 'cancelled', 'rejected', 'failed_delivery', '', null, undefined]) {
    assert.equal(canAdminForceCancelOrder({ status }), false, String(status));
  }
});

test('force-complete: pickup and restaurant-run delivery from the kitchen stages only', () => {
  for (const fulfillmentType of ['pickup', 'delivery']) {
    for (const status of ['accepted', 'preparing', 'ready_for_pickup']) {
      assert.equal(canAdminForceCompleteOrder({ fulfillmentType, status, pricing: {} }), true, `${fulfillmentType} ${status}`);
    }
    for (const status of ['placed', 'scheduled', 'on_the_way', 'picked_up', 'escalated', 'delivered', 'cancelled']) {
      assert.equal(canAdminForceCompleteOrder({ fulfillmentType, status, pricing: {} }), false, `${fulfillmentType} ${status}`);
    }
  }
  // Stamped restaurant and legacy unstamped are the same thing.
  assert.equal(
    canAdminForceCompleteOrder({ fulfillmentType: 'delivery', status: 'preparing', pricing: { deliveryProvider: 'restaurant' } }),
    true
  );
});

test('force-complete: a FEASTY rider delivery only from on_the_way', () => {
  const platform = { fulfillmentType: 'delivery', pricing: { deliveryProvider: 'platform' } };
  assert.equal(canAdminForceCompleteOrder({ ...platform, status: 'on_the_way' }), true);
  for (const status of ['accepted', 'preparing', 'ready_for_pickup', 'picked_up', 'delivered']) {
    assert.equal(canAdminForceCompleteOrder({ ...platform, status }), false, status);
  }
  // The platform stamp means nothing on a pickup.
  assert.equal(
    canAdminForceCompleteOrder({ fulfillmentType: 'pickup', pricing: { deliveryProvider: 'platform' }, status: 'ready_for_pickup' }),
    true
  );
});

test('a report can be resolved only while it is open (reported and still flagged)', () => {
  assert.equal(canAdminResolveOrderReport({ customerIssueReportedAt: '2026-11-09T11:00:00Z', needsAttention: true }), true);
  assert.equal(canAdminResolveOrderReport({ customerIssueReportedAt: '2026-11-09T11:00:00Z', needsAttention: false }), false);
  assert.equal(canAdminResolveOrderReport({ customerIssueReportedAt: null, needsAttention: true }), false);
});

const paidOrder = (overrides: Record<string, unknown> = {}) => ({
  restaurantId: 'rest-1',
  status: 'delivered',
  payment: { status: 'paid', settlementMode: 'manual' },
  pricing: { total: 4300, netSettlement: 3600, restaurantPayable: 3000, settlement: { netSettlement: 3600 } },
  ...overrides,
});

test('owed is the settlement figure, not the gross payment', () => {
  assert.deepEqual(restaurantOwedForOrder(paidOrder()), { amount: 3600, restaurantId: 'rest-1', settlementMode: 'manual' });
});

test('owed falls back to the nested settlement, then restaurantPayable', () => {
  assert.equal(restaurantOwedForOrder(paidOrder({ pricing: { settlement: { netSettlement: 3550 } } }))?.amount, 3550);
  assert.equal(restaurantOwedForOrder(paidOrder({ pricing: { restaurantPayable: 2900 } }))?.amount, 2900);
  assert.equal(restaurantOwedForOrder(paidOrder({ pricing: null }))?.amount, 0);
});

test('nothing is owed on a refunded, unpaid, cancelled or rejected order', () => {
  assert.equal(restaurantOwedForOrder(paidOrder({ payment: { status: 'refunded', settlementMode: 'split' } })), null);
  assert.equal(restaurantOwedForOrder(paidOrder({ payment: { status: 'pending' } })), null);
  assert.equal(restaurantOwedForOrder(paidOrder({ payment: null })), null);
  assert.equal(restaurantOwedForOrder(paidOrder({ status: 'cancelled' })), null);
  assert.equal(restaurantOwedForOrder(paidOrder({ status: 'rejected' })), null);
  assert.equal(restaurantOwedForOrder(paidOrder({ restaurantId: '  ' })), null);
});

test('the split vs manual distinction is kept, and an unrecorded mode is null', () => {
  assert.equal(restaurantOwedForOrder(paidOrder({ payment: { status: 'paid', settlementMode: 'split' } }))?.settlementMode, 'split');
  assert.equal(restaurantOwedForOrder(paidOrder({ payment: { status: 'paid' } }))?.settlementMode, null);
  assert.equal(restaurantOwedForOrder(paidOrder({ payment: { status: 'paid', settlementMode: 'weird' } }))?.settlementMode, null);
});

test('an in-flight paid order is owed (it drops out if it is later rejected or cancelled)', () => {
  assert.equal(restaurantOwedForOrder(paidOrder({ status: 'preparing' }))?.amount, 3600);
});
