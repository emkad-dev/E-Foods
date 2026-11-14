/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/domain/riderActionOutcome.test.ts
 *
 * A rider whose status reply was lost must see success when the order did move,
 * and a failure only when it did not.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dispatchActionSuccessMessage,
  hasCourierAssignmentLanded,
  hasDispatchActionReachedTarget,
  type DispatchStatusAction,
} from './riderActionOutcome.ts';

const reached = (action: DispatchStatusAction, status: string | null) => hasDispatchActionReachedTarget(action, status);

test('a lost "Delivered" reply on an order that is delivered counts as done', () => {
  assert.equal(reached('delivered', 'delivered'), true);
  assert.equal(reached('delivered', 'on_the_way'), false, 'the first tap did not land');
  assert.equal(reached('delivered', 'picked_up'), false);
});

test('pickup and on-the-way count once the order is at or past them', () => {
  assert.equal(reached('picked_up', 'picked_up'), true);
  assert.equal(reached('picked_up', 'on_the_way'), true);
  assert.equal(reached('picked_up', 'delivered'), true);
  assert.equal(reached('picked_up', 'ready_for_pickup'), false);
  assert.equal(reached('on_the_way', 'on_the_way'), true);
  assert.equal(reached('on_the_way', 'delivered'), true);
  assert.equal(reached('on_the_way', 'picked_up'), false);
  // Legacy spelling normalizes onto the path.
  assert.equal(reached('picked_up', 'ready'), false);
});

test('an order that ended off the path was not moved forward by this tap', () => {
  for (const status of ['cancelled', 'rejected', 'escalated', 'failed_delivery', null]) {
    for (const action of ['picked_up', 'on_the_way', 'delivered'] as const) {
      assert.equal(reached(action, status), false, `${action} on ${status}`);
    }
  }
});

test('failed delivery and escalation count only on their own status', () => {
  assert.equal(reached('failed_delivery', 'failed_delivery'), true);
  assert.equal(reached('failed_delivery', 'delivered'), false, 'delivered is not a failed delivery');
  assert.equal(reached('failed_delivery', 'on_the_way'), false);
  assert.equal(reached('escalate', 'escalated'), true);
  assert.equal(reached('escalate', 'on_the_way'), false);
  assert.equal(reached('escalate', 'cancelled'), false);
});

test('an assignment landed only when the rider it aimed for holds the order', () => {
  assert.equal(hasCourierAssignmentLanded({ courierId: 'rider-1' }, 'rider-1'), true);
  assert.equal(hasCourierAssignmentLanded({ courierId: 'rider-2' }, 'rider-1'), false);
  assert.equal(hasCourierAssignmentLanded({ courierId: null }, 'rider-1'), false);
  assert.equal(hasCourierAssignmentLanded(null, 'rider-1'), false);
  assert.equal(hasCourierAssignmentLanded({ courierId: '' }, ''), false, 'an empty target never matches');
});

test('every status action has a short receipt', () => {
  assert.equal(dispatchActionSuccessMessage('delivered'), 'Order delivered');
  assert.equal(dispatchActionSuccessMessage('picked_up'), 'Pickup confirmed');
  for (const action of ['picked_up', 'on_the_way', 'delivered', 'failed_delivery', 'escalate'] as const) {
    assert.ok(dispatchActionSuccessMessage(action).length > 0);
  }
});
