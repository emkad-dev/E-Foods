import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessPaystackRefund,
  canMarkRefundedManually,
  canResumeRefundExecution,
  canStartRefundExecution,
  isRefundOnItsWay,
  mapPaystackRefundStatus,
  readRefundExecution,
  shouldApplyRefundStatus,
} from './refundExecution.ts';

const payment = (overrides: Record<string, unknown> = {}) => ({
  capturedAmount: 4300,
  method: 'card',
  provider: 'paystack',
  reference: 'FEASTY-CRD-1',
  refundAmount: 4300,
  status: 'refunded',
  ...overrides,
});

test('a refund may start only when none exists or the last attempt failed', () => {
  assert.equal(canStartRefundExecution(null), true);
  assert.equal(canStartRefundExecution(readRefundExecution({ refundExecution: { status: 'failed' } })), true);
  for (const status of ['requested', 'pending', 'processing', 'processed', 'needs_attention']) {
    assert.equal(canStartRefundExecution(readRefundExecution({ refundExecution: { status } })), false, status);
  }
});

test('a corrupt execution reads as needs_attention, never as absent', () => {
  assert.equal(readRefundExecution({ refundExecution: 'garbage' })?.status, 'needs_attention');
  assert.equal(readRefundExecution({ refundExecution: { status: 'weird' } })?.status, 'needs_attention');
  assert.equal(readRefundExecution({}), null);
});

test('assessPaystackRefund returns the recorded amount, capped by what was captured', () => {
  assert.deepEqual(assessPaystackRefund(payment(), true), { amount: 4300, ok: true, resume: false, transactionReference: 'FEASTY-CRD-1' });
  assert.deepEqual(assessPaystackRefund(payment({ refundAmount: 2150 }), true), {
    amount: 2150,
    ok: true,
    resume: false,
    transactionReference: 'FEASTY-CRD-1',
  });
  assert.deepEqual(assessPaystackRefund(payment({ refundAmount: 4300.01 }), true), { ok: false, reason: 'over_cap' });
  assert.deepEqual(assessPaystackRefund(payment({ capturedAmount: null }), true), { ok: false, reason: 'over_cap' });
  assert.deepEqual(assessPaystackRefund(payment({ refundAmount: 0 }), true), { ok: false, reason: 'no_amount' });
});

test('assessPaystackRefund refuses unrecorded, uncaptured, non-Paystack and already-started refunds', () => {
  assert.deepEqual(assessPaystackRefund(payment({ status: 'paid' }), true), { ok: false, reason: 'not_recorded' });
  assert.deepEqual(assessPaystackRefund(payment(), false), { ok: false, reason: 'not_captured' });
  assert.deepEqual(assessPaystackRefund(payment({ method: 'cash' }), true), { ok: false, reason: 'not_paystack' });
  assert.deepEqual(assessPaystackRefund(payment({ provider: 'cash_on_delivery' }), true), { ok: false, reason: 'not_paystack' });
  assert.deepEqual(assessPaystackRefund(payment({ reference: ' ' }), true), { ok: false, reason: 'no_reference' });
  assert.deepEqual(assessPaystackRefund(payment({ refundExecution: { status: 'pending' } }), true), {
    ok: false,
    reason: 'already_started',
  });
  assert.equal(assessPaystackRefund(payment({ refundExecution: { status: 'failed' } }), true).ok, true);
});

test("Paystack's refund statuses map to ours", () => {
  assert.equal(mapPaystackRefundStatus('refund.needs-attention'), 'needs_attention');
  assert.equal(mapPaystackRefundStatus('processed'), 'processed');
  assert.equal(mapPaystackRefundStatus('refund.failed'), 'failed');
  assert.equal(mapPaystackRefundStatus('reversed'), null);
});

test('refund events only move forward and the final states never change', () => {
  assert.equal(shouldApplyRefundStatus('requested', 'pending'), true);
  assert.equal(shouldApplyRefundStatus('pending', 'processed'), true);
  assert.equal(shouldApplyRefundStatus('processing', 'pending'), false);
  assert.equal(shouldApplyRefundStatus('needs_attention', 'processing'), true);
  assert.equal(shouldApplyRefundStatus('processing', 'needs_attention'), true);
  assert.equal(shouldApplyRefundStatus('processed', 'failed'), false);
  assert.equal(shouldApplyRefundStatus('failed', 'processed'), false);
  assert.equal(shouldApplyRefundStatus('processed', 'processed'), false);
});

test('"on its way" only once Paystack is processing or done', () => {
  assert.equal(isRefundOnItsWay(payment()), false);
  assert.equal(isRefundOnItsWay(payment({ refundExecution: { status: 'pending' } })), false);
  assert.equal(isRefundOnItsWay(payment({ refundExecution: { status: 'processing' } })), true);
  assert.equal(isRefundOnItsWay(payment({ refundExecution: { status: 'processed' } })), true);
});

test('a stale requested claim, or an unconfirmed needs_attention for an admin, is resumed with its own reference', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const exec = (fields: Record<string, unknown>) => readRefundExecution({ refundExecution: { reference: 'feasty_rf_x_1', ...fields } });
  assert.equal(canResumeRefundExecution(exec({ status: 'requested', requestedAt: '2026-11-17T11:49:00.000Z' }), { allowUnconfirmed: false, nowMs: now }), true);
  assert.equal(canResumeRefundExecution(exec({ status: 'requested', requestedAt: '2026-11-17T11:55:00.000Z' }), { allowUnconfirmed: false, nowMs: now }), false);
  assert.equal(canResumeRefundExecution(exec({ status: 'needs_attention', unconfirmed: true }), { allowUnconfirmed: true, nowMs: now }), true);
  assert.equal(canResumeRefundExecution(exec({ status: 'needs_attention', unconfirmed: true }), { allowUnconfirmed: false, nowMs: now }), false);
  assert.equal(canResumeRefundExecution(exec({ status: 'needs_attention' }), { allowUnconfirmed: true, nowMs: now }), false, 'Paystack needs bank details');
  assert.equal(canResumeRefundExecution(readRefundExecution({ refundExecution: { status: 'needs_attention', unconfirmed: true } }), { allowUnconfirmed: true, nowMs: now }), false, 'no reference to reuse');
  const resumed = assessPaystackRefund(
    payment({ refundExecution: { amount: 4300, reference: 'feasty_rf_x_1', requestedAt: '2026-11-17T11:00:00.000Z', status: 'requested' } }),
    true,
    { nowMs: now }
  );
  assert.deepEqual(resumed, { amount: 4300, ok: true, resume: true, transactionReference: 'FEASTY-CRD-1' });
});

test('marking refunded by hand is allowed only when nothing is in flight at Paystack', () => {
  assert.equal(canMarkRefundedManually(null), true);
  for (const status of ['failed', 'needs_attention']) {
    assert.equal(canMarkRefundedManually(readRefundExecution({ refundExecution: { status } })), true, status);
  }
  for (const status of ['requested', 'pending', 'processing', 'processed']) {
    assert.equal(canMarkRefundedManually(readRefundExecution({ refundExecution: { status } })), false, status);
  }
});
