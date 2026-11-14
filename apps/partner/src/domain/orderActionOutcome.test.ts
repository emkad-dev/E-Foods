/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/orderActionOutcome.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatPartnerOrderStatusLabel,
  hasOrderReachedActionTarget,
  orderActionSuccessMessage,
  resolveFailedOrderAction,
  type PartnerOrderAction,
} from './orderActionOutcome.ts';

const reached = (action: PartnerOrderAction, status: string, fulfillmentType: string | null = 'delivery') =>
  hasOrderReachedActionTarget(action, status, fulfillmentType);

test('the incident: a collected pickup order means "Mark collected" worked', () => {
  assert.equal(reached('delivered', 'delivered', 'pickup'), true);
  assert.equal(reached('delivered', 'ready_for_pickup', 'pickup'), false);
  assert.equal(reached('delivered', 'preparing', 'pickup'), false);
});

test('accept is reached at accepted or any later forward step, delivery', () => {
  for (const status of ['accepted', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way', 'delivered']) {
    assert.equal(reached('accept', status), true, status);
  }
  assert.equal(reached('accept', 'placed'), false);
});

test('accept is reached at accepted or any later forward step, pickup', () => {
  for (const status of ['accepted', 'preparing', 'ready_for_pickup', 'delivered']) {
    assert.equal(reached('accept', status, 'pickup'), true, status);
  }
  assert.equal(reached('accept', 'placed', 'pickup'), false);
});

test('preparing and ready are reached at their step or later, not before', () => {
  assert.equal(reached('preparing', 'accepted'), false);
  assert.equal(reached('preparing', 'preparing'), true);
  assert.equal(reached('preparing', 'ready_for_pickup'), true);
  assert.equal(reached('ready', 'preparing'), false);
  assert.equal(reached('ready', 'ready_for_pickup'), true);
  assert.equal(reached('ready', 'on_the_way'), true);
  assert.equal(reached('ready', 'delivered', 'pickup'), true);
});

test('delivered is reached only at delivered, for delivery orders too', () => {
  assert.equal(reached('delivered', 'delivered'), true);
  assert.equal(reached('delivered', 'on_the_way'), false);
  assert.equal(reached('delivered', 'picked_up'), false);
});

test('a terminal status off the forward path never counts as a forward action done', () => {
  for (const action of ['accept', 'preparing', 'ready', 'delivered'] as const) {
    for (const status of ['cancelled', 'rejected', 'failed_delivery', 'escalated']) {
      assert.equal(reached(action, status), false, `${action} vs ${status}`);
      assert.equal(reached(action, status, 'pickup'), false, `${action} vs ${status} (pickup)`);
    }
  }
});

test('rider steps are not part of a pickup order, so they do not count there', () => {
  assert.equal(reached('accept', 'on_the_way', 'pickup'), false);
  assert.equal(reached('accept', 'picked_up', 'pickup'), false);
});

test('reject is reached only when the order was rejected', () => {
  assert.equal(reached('reject', 'rejected'), true);
  assert.equal(reached('reject', 'rejected', 'pickup'), true);
  for (const status of ['cancelled', 'placed', 'accepted', 'preparing', 'delivered', 'failed_delivery']) {
    assert.equal(reached('reject', status), false, status);
  }
});

test('after a failed call: done when the order got there, failed when it did not', () => {
  assert.equal(resolveFailedOrderAction('delivered', 'delivered', 'pickup'), 'done');
  assert.equal(resolveFailedOrderAction('accept', 'preparing', 'delivery'), 'done');
  assert.equal(resolveFailedOrderAction('reject', 'rejected', 'delivery'), 'done');
  assert.equal(resolveFailedOrderAction('accept', 'placed', 'delivery'), 'failed');
  assert.equal(resolveFailedOrderAction('reject', 'accepted', 'pickup'), 'failed');
});

test('a reject that finds the order cancelled is neither done nor failed', () => {
  assert.equal(resolveFailedOrderAction('reject', 'cancelled', 'delivery'), 'cancelled');
  assert.equal(resolveFailedOrderAction('reject', 'cancelled', 'pickup'), 'cancelled');
  // Only a reject gets the neutral outcome; a forward action on a cancelled order failed.
  for (const action of ['accept', 'preparing', 'ready', 'delivered'] as const) {
    assert.equal(resolveFailedOrderAction(action, 'cancelled', 'delivery'), 'failed', action);
  }
});

test('legacy and unknown statuses are read the way the rest of the app reads them', () => {
  assert.equal(reached('accept', 'pending'), false);
  assert.equal(reached('ready', 'ready'), true);
  assert.equal(reached('accept', 'nonsense'), false);
  assert.equal(reached('accept', ''), false);
  assert.equal(hasOrderReachedActionTarget('accept', null, null), false);
});

test('a missing fulfilment type is a delivery order', () => {
  assert.equal(hasOrderReachedActionTarget('accept', 'on_the_way', null), true);
  assert.equal(orderActionSuccessMessage('delivered', undefined), 'Order delivered. Waiting for the customer to confirm.');
});

test('success messages say what happened', () => {
  assert.equal(orderActionSuccessMessage('accept', 'delivery'), 'Order accepted');
  assert.equal(orderActionSuccessMessage('preparing', 'pickup'), 'Marked as preparing');
  assert.equal(orderActionSuccessMessage('ready', 'pickup'), 'Marked ready for pickup');
  assert.equal(orderActionSuccessMessage('ready', 'delivery'), 'Marked ready');
  assert.equal(orderActionSuccessMessage('delivered', 'pickup'), 'Order collected. Waiting for the customer to confirm.');
  assert.equal(orderActionSuccessMessage('delivered', 'delivery'), 'Order delivered. Waiting for the customer to confirm.');
  assert.equal(orderActionSuccessMessage('reject', 'pickup'), 'Order rejected');
});

test('a collected pickup order reads Collected; everything else reads as before', () => {
  assert.equal(formatPartnerOrderStatusLabel('delivered', 'pickup'), 'Collected');
  assert.equal(formatPartnerOrderStatusLabel('delivered', 'delivery'), 'Delivered');
  assert.equal(formatPartnerOrderStatusLabel('delivered', null), 'Delivered');
  assert.equal(formatPartnerOrderStatusLabel('ready_for_pickup', 'pickup'), 'Ready for pickup');
  assert.equal(formatPartnerOrderStatusLabel('cancelled', 'pickup'), 'Cancelled');
});
