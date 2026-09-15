/**
 * Run with: node --test --experimental-strip-types apps/customer/src/services/checkoutIdempotency.test.ts
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  CHECKOUT_RETRY_WINDOW_MS,
  buildCheckoutFingerprint,
  resetCheckoutIdempotencyAttempt,
  resolveCheckoutIdempotencyKey,
  type CheckoutIdempotencyInput,
} from './checkoutIdempotency.ts';

const baseInput = (overrides: Partial<CheckoutIdempotencyInput> = {}): CheckoutIdempotencyInput => ({
  deliveryLocation: { address: '12 Awolowo Road', latitude: 6.4474, longitude: 3.4553 },
  fulfillmentType: 'delivery',
  items: [
    { id: 'item-1', quantity: 2, restaurantId: 'rest-1' },
    { id: 'item-2', quantity: 1, restaurantId: 'rest-2' },
  ],
  paymentMethod: 'card',
  promoCode: null,
  restaurantId: 'rest-1',
  scheduledFor: null,
  tipAmount: 0,
  ...overrides,
});

beforeEach(() => {
  resetCheckoutIdempotencyAttempt();
});

test('an unchanged basket keeps one key across retries, so a double-tap hits the server idempotency record', () => {
  const first = resolveCheckoutIdempotencyKey(baseInput(), 1_000);
  const second = resolveCheckoutIdempotencyKey(baseInput(), 1_400);
  const third = resolveCheckoutIdempotencyKey(baseInput(), 60_000);

  assert.equal(second, first);
  assert.equal(third, first);
});

test('cart order does not change the fingerprint', () => {
  const forwards = baseInput();
  const backwards = baseInput({ items: [...baseInput().items].reverse() });

  assert.equal(buildCheckoutFingerprint(backwards), buildCheckoutFingerprint(forwards));
});

test('every field that makes it a different order changes the key', () => {
  const reference = buildCheckoutFingerprint(baseInput());

  const variants: Partial<CheckoutIdempotencyInput>[] = [
    { items: [{ id: 'item-1', quantity: 3, restaurantId: 'rest-1' }, { id: 'item-2', quantity: 1, restaurantId: 'rest-2' }] },
    { items: [{ id: 'item-1', quantity: 2, restaurantId: 'rest-1' }] },
    { items: [{ id: 'item-1', quantity: 2, restaurantId: 'rest-3' }, { id: 'item-2', quantity: 1, restaurantId: 'rest-2' }] },
    { fulfillmentType: 'pickup' },
    { paymentMethod: 'bank_transfer' },
    { restaurantId: 'rest-2' },
    { tipAmount: 500 },
    { promoCode: 'WELCOME10' },
    { scheduledFor: '2026-09-16T18:00:00.000Z' },
    { deliveryLocation: { address: '9 Marina', latitude: 6.4474, longitude: 3.4553 } },
    { deliveryLocation: { address: '12 Awolowo Road', latitude: 6.5, longitude: 3.4553 } },
    { deliveryLocation: null },
  ];

  for (const variant of variants) {
    assert.notEqual(
      buildCheckoutFingerprint(baseInput(variant)),
      reference,
      `expected a different fingerprint for ${JSON.stringify(variant)}`
    );
  }
});

test('changing the basket mid-attempt mints a new key immediately', () => {
  const first = resolveCheckoutIdempotencyKey(baseInput(), 1_000);
  const changed = resolveCheckoutIdempotencyKey(baseInput({ tipAmount: 300 }), 1_100);

  assert.notEqual(changed, first);
});

test('re-ordering the identical basket after the retry window is a new order', () => {
  const first = resolveCheckoutIdempotencyKey(baseInput(), 1_000);
  const later = resolveCheckoutIdempotencyKey(baseInput(), 1_000 + CHECKOUT_RETRY_WINDOW_MS);

  assert.notEqual(later, first);
});

test('keys are bounded regardless of basket size', () => {
  const items = Array.from({ length: 120 }, (_, index) => ({
    id: `item-${index}`,
    quantity: index + 1,
    restaurantId: `rest-${index % 4}`,
  }));

  const key = resolveCheckoutIdempotencyKey(baseInput({ items }), 1_000);

  assert.ok(key.length < 64, `expected a bounded key, got ${key.length} characters`);
  assert.match(key, /^cust-[0-9a-f]{16}-[0-9a-z]+$/);
});
