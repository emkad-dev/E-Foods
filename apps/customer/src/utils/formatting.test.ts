/**
 * Run with: node --test --experimental-strip-types apps/customer/src/utils/formatting.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDeliveryEta, formatDistanceAway, formatMoney } from './formatting.ts';

test('formatMoney renders two decimals with the naira sign', () => {
  assert.equal(formatMoney(4300), '₦4300.00');
  assert.equal(formatMoney(0), '₦0.00');
  assert.equal(formatMoney(1234.5), '₦1234.50');
});

test('formatMoney survives the missing pricing fields that used to throw', () => {
  // Five of the six inline copies called `amount.toFixed(2)` on a value typed
  // `number` that an RPC payload can legitimately omit (serviceFee, tip,
  // refundAmount), which crashed the whole screen instead of the one line.
  assert.equal(formatMoney(undefined), '₦0.00');
  assert.equal(formatMoney(null), '₦0.00');
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
