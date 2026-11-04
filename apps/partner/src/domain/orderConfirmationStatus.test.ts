/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/orderConfirmationStatus.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOrderConfirmationStatus } from './orderConfirmationStatus.ts';

const DUE = '2026-11-04T15:00:00.000Z';
const AT = '2026-11-04T13:30:00.000Z';

test('an order outside the flow shows nothing', () => {
  assert.equal(getOrderConfirmationStatus({}), null);
  assert.equal(getOrderConfirmationStatus({ customerConfirmDueAt: null }), null);
});

test('an order outside the flow shows nothing even if other fields are set', () => {
  assert.equal(
    getOrderConfirmationStatus({ customerConfirmedAt: AT, customerConfirmationSource: 'customer' }),
    null
  );
});

test('in the flow with no response yet is waiting', () => {
  assert.equal(getOrderConfirmationStatus({ customerConfirmDueAt: DUE }), 'Waiting for customer to confirm');
});

test('a customer confirmation reads as confirmed', () => {
  assert.equal(
    getOrderConfirmationStatus({
      customerConfirmDueAt: DUE,
      customerConfirmedAt: AT,
      customerConfirmationSource: 'customer',
    }),
    'Customer confirmed'
  );
});

test('the three-hour auto-close reads as closed automatically', () => {
  assert.equal(
    getOrderConfirmationStatus({
      customerConfirmDueAt: DUE,
      customerConfirmedAt: DUE,
      customerConfirmationSource: 'auto',
    }),
    'Closed automatically'
  );
});

test('a reported problem reads as such', () => {
  assert.equal(
    getOrderConfirmationStatus({ customerConfirmDueAt: DUE, customerIssueReportedAt: AT }),
    'Customer reported a problem'
  );
});

test('a report followed by a customer confirmation shows confirmed', () => {
  assert.equal(
    getOrderConfirmationStatus({
      customerConfirmDueAt: DUE,
      customerIssueReportedAt: AT,
      customerConfirmedAt: DUE,
      customerConfirmationSource: 'customer',
    }),
    'Customer confirmed'
  );
});

test('a reported problem takes priority over waiting but a stray source alone does not confirm', () => {
  assert.equal(
    getOrderConfirmationStatus({
      customerConfirmDueAt: DUE,
      customerIssueReportedAt: AT,
      customerConfirmationSource: 'customer',
    }),
    'Customer reported a problem'
  );
});

test('a confirmation with no recorded source is treated as the customer', () => {
  assert.equal(
    getOrderConfirmationStatus({ customerConfirmDueAt: DUE, customerConfirmedAt: AT, customerConfirmationSource: null }),
    'Customer confirmed'
  );
});
