/**
 * Run with: node --test --experimental-strip-types apps/customer/src/utils/formatting.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDeliveryEta, formatDistanceAway, formatMoney } from './formatting.ts';

/**
 * `formatMoney` used to be `₦${amount.toFixed(2)}`: no thousands separator and
 * always two kobo digits, so every price in the app (and the store
 * screenshots) printed `₦4300.00` instead of `₦4,300`.
 */
test('formatMoney hand-groups thousands and drops kobo when there are none', () => {
  assert.equal(formatMoney(4300), '₦4,300');
  assert.equal(formatMoney(4540), '₦4,540');
  assert.equal(formatMoney(1234567), '₦1,234,567');
});

test('formatMoney shows kobo, as two digits, only when they are non-zero', () => {
  assert.equal(formatMoney(4300.5), '₦4,300.50');
  assert.equal(formatMoney(99.99), '₦99.99');
});

test('formatMoney survives the missing pricing fields that used to throw', () => {
  // Five of the six inline copies called `amount.toFixed(2)` on a value typed
  // `number` that an RPC payload can legitimately omit (serviceFee, tip,
  // refundAmount), which crashed the whole screen instead of the one line.
  assert.equal(formatMoney(0), '₦0');
  assert.equal(formatMoney(undefined), '₦0');
  assert.equal(formatMoney(null), '₦0');
});

test('formatMoney renders a non-finite amount as zero rather than "₦NaN"', () => {
  assert.equal(formatMoney(Number.NaN), '₦0');
  assert.equal(formatMoney(Number.POSITIVE_INFINITY), '₦0');
});

test('formatMoney signs a negative amount with a leading minus before the naira sign', () => {
  assert.equal(formatMoney(-2500), '-₦2,500');
});

test('formatMoney rounds to kobo before formatting, so a sub-kobo value collapses to zero', () => {
  assert.equal(formatMoney(0.004), '₦0');
});

test('formatDistanceAway keeps one decimal place', () => {
  assert.equal(formatDistanceAway(3.42), '3.4 km away');
  assert.equal(formatDistanceAway(12), '12.0 km away');
  assert.equal(formatDistanceAway(0.04), '0.0 km away');
});

test('formatDeliveryEta passes a partner-published estimate straight through', () => {
  assert.equal(formatDeliveryEta('20-30 min'), '20-30 min');
  // `deliveryTime` is typed `string | number`; a bare number stringifies exactly
  // as the inline copies rendered it.
  assert.equal(formatDeliveryEta(30), '30');
});

test('formatDeliveryEta invents nothing when the partner published no estimate', () => {
  // The old `?? '25-35 min'` quoted every unconfigured kitchen the same made-up
  // delivery promise. Absent means absent.
  assert.equal(formatDeliveryEta(undefined), null);
  assert.equal(formatDeliveryEta(null), null);
});

test('formatDeliveryEta treats a blank value as unset', () => {
  // `??` let an empty or whitespace-only string through, rendering an ETA label
  // with nothing after it.
  assert.equal(formatDeliveryEta(''), null);
  assert.equal(formatDeliveryEta('   '), null);
});
