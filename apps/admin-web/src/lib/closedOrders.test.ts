import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeCancelledBreakdown, describeClosure, summarizeClosedOrders } from './closedOrders.ts';

test('every reason the backend writes reads as plain words', () => {
  assert.deepEqual(describeClosure({ status: 'cancelled', cancellation: { actor: 'system', reason: 'payment_timeout' } }), {
    why: 'Payment timed out',
    by: 'System',
  });
  assert.equal(describeClosure({ status: 'cancelled', cancellation: { reason: 'payment_initialization_failed' } }).why, 'Payment never started');
  assert.equal(describeClosure({ status: 'cancelled', cancellation: { reason: 'acceptance_deadline' } }).why, 'Restaurant did not respond in time');
  assert.equal(describeClosure({ status: 'cancelled', cancellation: { actor: 'admin', reason: 'admin_force_cancel' } }).by, 'Admin');
});

test('a customer cancellation with no reason still says who did it', () => {
  // Six production orders look exactly like this.
  assert.deepEqual(describeClosure({ status: 'cancelled', cancellation: { actor: 'customer' } }), {
    why: 'Cancelled by the customer',
    by: 'Customer',
  });
});

test('a rejection with no cancellation object is the restaurant\'s decision', () => {
  // Every rejected order in production has no cancellation object.
  assert.deepEqual(describeClosure({ status: 'rejected', cancellation: null }), {
    why: 'Rejected by the restaurant',
    by: 'Restaurant',
  });
});

test('an unknown reason is humanised, never hidden', () => {
  assert.equal(describeClosure({ status: 'cancelled', cancellation: { reason: 'brand_new_reason' } }).why, 'Brand new reason');
  assert.equal(describeClosure({ status: 'cancelled' }).why, 'No reason recorded');
});

test('the summary splits abandoned checkouts from real decisions', () => {
  const summary = summarizeClosedOrders([
    { status: 'cancelled', cancellation: { actor: 'system', reason: 'payment_timeout' } },
    { status: 'cancelled', cancellation: { actor: 'system', reason: 'payment_failed' } },
    { status: 'cancelled', cancellation: { actor: 'customer' } },
    { status: 'cancelled', cancellation: { actor: 'admin', reason: 'admin_force_cancel' } },
    { status: 'rejected' },
    { status: 'failed_delivery' },
  ]);

  assert.deepEqual(summary, {
    cancelled: 4,
    rejected: 1,
    failedDelivery: 1,
    unpaidCheckouts: 2,
    byCustomer: 1,
    otherCancelled: 1,
  });
  assert.equal(describeCancelledBreakdown(summary), '2 unpaid checkouts, 1 by customer, 1 other');
});

test('an empty period says so instead of showing a bare zero', () => {
  assert.equal(describeCancelledBreakdown(summarizeClosedOrders([])), 'None in this period');
});
