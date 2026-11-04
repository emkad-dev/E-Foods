/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/orderConfirmation.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONFIRM_LABELS,
  MAX_PROBLEM_LENGTH,
  formatAutoCloseNotice,
  getConfirmationPhase,
  pickOrderAwaitingConfirmation,
  validateProblemMessage,
} from './orderConfirmation.ts';

const DUE = '2026-11-04T20:40:00.000Z';

const order = (overrides: Record<string, unknown> = {}) => ({
  customerConfirmDueAt: DUE,
  id: 'order-1',
  status: 'delivered',
  ...overrides,
});

// --- getConfirmationPhase ---------------------------------------------------

test('getConfirmationPhase: a restaurant-completed order with a deadline is awaiting', () => {
  assert.equal(getConfirmationPhase(order()), 'awaiting');
});

test('getConfirmationPhase: no deadline means the order never entered the flow', () => {
  // Rider orders closed by delivery code, and orders delivered before the
  // feature shipped, carry no customerConfirmDueAt.
  assert.equal(getConfirmationPhase(order({ customerConfirmDueAt: null })), 'none');
  assert.equal(getConfirmationPhase(order({ customerConfirmDueAt: undefined })), 'none');
});

test('getConfirmationPhase: only delivered orders are in the flow', () => {
  assert.equal(getConfirmationPhase(order({ status: 'preparing' })), 'none');
  assert.equal(getConfirmationPhase(order({ status: 'cancelled' })), 'none');
});

test('getConfirmationPhase: a customer confirmation is confirmed', () => {
  assert.equal(
    getConfirmationPhase(order({ customerConfirmedAt: DUE, customerConfirmationSource: 'customer' })),
    'confirmed'
  );
});

test('getConfirmationPhase: an auto-close is auto_closed', () => {
  assert.equal(
    getConfirmationPhase(order({ customerConfirmedAt: DUE, customerConfirmationSource: 'auto' })),
    'auto_closed'
  );
});

test('getConfirmationPhase: confirmed with no recorded source reads as customer-confirmed', () => {
  assert.equal(getConfirmationPhase(order({ customerConfirmedAt: DUE })), 'confirmed');
});

test('getConfirmationPhase: a report without confirmation is reported', () => {
  assert.equal(getConfirmationPhase(order({ customerIssueReportedAt: DUE })), 'reported');
});

test('getConfirmationPhase: confirming after a report closes the order', () => {
  assert.equal(
    getConfirmationPhase(
      order({ customerIssueReportedAt: DUE, customerConfirmedAt: DUE, customerConfirmationSource: 'customer' })
    ),
    'confirmed'
  );
});

// --- pickOrderAwaitingConfirmation -----------------------------------------

test('pickOrderAwaitingConfirmation: nothing awaiting yields null', () => {
  assert.equal(pickOrderAwaitingConfirmation([]), null);
  assert.equal(
    pickOrderAwaitingConfirmation([order({ customerConfirmDueAt: null }), order({ customerConfirmedAt: DUE })]),
    null
  );
});

test('pickOrderAwaitingConfirmation: a reported order no longer prompts on home', () => {
  // Reporting stops the auto-close timer and FEASTY is already on it; the
  // order screen still offers confirm, but home should not keep nagging.
  assert.equal(pickOrderAwaitingConfirmation([order({ customerIssueReportedAt: DUE })]), null);
});

test('pickOrderAwaitingConfirmation: picks the most recently completed awaiting order', () => {
  const older = order({ id: 'older', customerConfirmDueAt: '2026-11-04T18:00:00.000Z' });
  const newer = order({ id: 'newer', customerConfirmDueAt: '2026-11-04T20:00:00.000Z' });
  const confirmed = order({
    customerConfirmDueAt: '2026-11-04T23:00:00.000Z',
    customerConfirmedAt: DUE,
    id: 'confirmed',
  });
  assert.equal(pickOrderAwaitingConfirmation([older, confirmed, newer])?.id, 'newer');
});

test('pickOrderAwaitingConfirmation: tolerates junk entries from the payload', () => {
  assert.equal(pickOrderAwaitingConfirmation([null, undefined, 'x', 3] as unknown[]), null);
});

// --- labels and notices -----------------------------------------------------

test('CONFIRM_LABELS: delivery and collection use the agreed wording', () => {
  assert.equal(CONFIRM_LABELS.delivery, 'I received my order');
  assert.equal(CONFIRM_LABELS.pickup, "I've collected my order");
});

test('formatAutoCloseNotice: names the closing time in the given locale and zone', () => {
  assert.equal(
    formatAutoCloseNotice(DUE, new Date('2026-11-04T19:00:00.000Z'), { locale: 'en-US', timeZone: 'UTC' }),
    'Closes automatically at 8:40 PM'
  );
});

test('formatAutoCloseNotice: omits the time once it has passed or is unusable', () => {
  // The sweep closes the order within a minute of the deadline; until then a
  // past time on screen would read as already-closed, which it is not.
  const now = new Date('2026-11-04T21:00:00.000Z');
  assert.equal(formatAutoCloseNotice(DUE, now), null);
  assert.equal(formatAutoCloseNotice(null, now), null);
  assert.equal(formatAutoCloseNotice('not a date', now), null);
});

// --- validateProblemMessage -------------------------------------------------

test('validateProblemMessage: blank is rejected, text is trimmed', () => {
  assert.deepEqual(validateProblemMessage('   \n '), { ok: false, error: 'Please describe the problem.' });
  assert.deepEqual(validateProblemMessage('  Missing fries '), { ok: true, message: 'Missing fries' });
});

test('validateProblemMessage: the 500 character cap is inclusive', () => {
  assert.equal(MAX_PROBLEM_LENGTH, 500);
  assert.equal(validateProblemMessage('a'.repeat(500)).ok, true);
  assert.deepEqual(validateProblemMessage('a'.repeat(501)), {
    ok: false,
    error: 'Please keep the description under 500 characters.',
  });
});
