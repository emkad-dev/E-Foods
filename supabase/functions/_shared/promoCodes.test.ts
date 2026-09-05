// Task 17 (G1): unit tests for the PURE promo-code eligibility logic. No DB, no
// env — this runs in the first (checked) `deno test` invocation. The atomic cap
// enforcement is NOT here (it is SQL + the handler race test in
// domains/promoCodes.test.ts); this file covers window / scope / min-basket /
// normalization / message mapping, which are the stale-client-proof server
// checks that gate a code before it ever reaches redemption.

import {
  normalizePromoCode,
  promoRedemptionMessage,
  promoRejectionMessage,
  validatePromoCodeForBasket,
  type PromoCodeRow,
} from './promoCodes.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const NOW = new Date('2026-08-21T12:00:00.000Z');

const baseCode = (overrides: Partial<PromoCodeRow> = {}): PromoCodeRow => ({
  code: 'SAVE10',
  endsAt: null,
  fundingSource: 'platform',
  globalCap: null,
  id: 'promo-1',
  isActive: true,
  isAutomatic: false,
  minBasket: 0,
  perUserCap: null,
  restaurantId: null,
  startsAt: null,
  type: 'percent',
  value: 10,
  ...overrides,
});

const validate = (promoCode: PromoCodeRow | null, restaurantId = 'rest-A', restaurantBasis = 10000) =>
  validatePromoCodeForBasket({ promoCode, restaurantId, restaurantBasis, now: NOW });

Deno.test('normalizePromoCode upper-cases and trims; non-strings become empty', () => {
  expectEqual(normalizePromoCode('  save10 '), 'SAVE10', 'trim + upper');
  expectEqual(normalizePromoCode('Free_Del'), 'FREE_DEL', 'mixed case');
  expectEqual(normalizePromoCode(null), '', 'null');
  expectEqual(normalizePromoCode(42), '', 'number');
});

Deno.test('a missing code is not_found', () => {
  const result = validate(null);
  expectEqual(result.ok, false, 'not ok');
  if (!result.ok) {
    expectEqual(result.reason, 'not_found', 'reason');
  }
});

Deno.test('an inactive code is refused', () => {
  const result = validate(baseCode({ isActive: false }));
  expectEqual(result.ok, false, 'not ok');
  if (!result.ok) {
    expectEqual(result.reason, 'inactive', 'reason');
  }
});

Deno.test('a code whose startsAt is in the future is not_started', () => {
  const result = validate(baseCode({ startsAt: '2026-09-01T00:00:00.000Z' }));
  expectEqual(result.ok, false, 'not ok');
  if (!result.ok) {
    expectEqual(result.reason, 'not_started', 'reason');
  }
});

Deno.test('a code whose endsAt is in the past is expired', () => {
  const result = validate(baseCode({ endsAt: '2026-08-01T00:00:00.000Z' }));
  expectEqual(result.ok, false, 'not ok');
  if (!result.ok) {
    expectEqual(result.reason, 'expired', 'reason');
  }
});

Deno.test('a code inside its window is accepted', () => {
  const result = validate(
    baseCode({ startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z' })
  );
  expectEqual(result.ok, true, 'ok');
});

Deno.test('a code scoped to restaurant A is refused on restaurant B', () => {
  const result = validate(baseCode({ restaurantId: 'rest-A' }), 'rest-B');
  expectEqual(result.ok, false, 'not ok');
  if (!result.ok) {
    expectEqual(result.reason, 'wrong_restaurant', 'reason');
  }
});

Deno.test('a code scoped to restaurant A is accepted on restaurant A', () => {
  const result = validate(baseCode({ restaurantId: 'rest-A' }), 'rest-A');
  expectEqual(result.ok, true, 'ok');
});

Deno.test('a platform-wide code (null restaurantId) applies to any restaurant', () => {
  expectEqual(validate(baseCode({ restaurantId: null }), 'rest-A').ok, true, 'A');
  expectEqual(validate(baseCode({ restaurantId: null }), 'rest-Z').ok, true, 'Z');
});

Deno.test('a basket below the minimum is refused with min_basket and echoes the minimum', () => {
  const result = validate(baseCode({ minBasket: 12000 }), 'rest-A', 10000);
  expectEqual(result.ok, false, 'not ok');
  if (!result.ok) {
    expectEqual(result.reason, 'min_basket', 'reason');
    expectEqual(result.minBasket, 12000, 'minBasket echoed');
  }
});

Deno.test('the minimum-basket check runs on the restaurant BASE basis, at exactly the threshold', () => {
  expectEqual(validate(baseCode({ minBasket: 10000 }), 'rest-A', 10000).ok, true, 'at threshold ok');
  expectEqual(validate(baseCode({ minBasket: 10000 }), 'rest-A', 9999.99).ok, false, 'a kobo short refused');
});

Deno.test('an accepted code returns the ResolvedDiscount straight from the row', () => {
  const result = validate(baseCode({ type: 'fixed', value: 500, fundingSource: 'restaurant' }));
  expectEqual(result.ok, true, 'ok');
  if (result.ok) {
    expectEqual(result.discount.type, 'fixed', 'type');
    expectEqual(result.discount.value, 500, 'value');
    expectEqual(result.discount.fundingSource, 'restaurant', 'fundingSource');
  }
});

Deno.test('a malformed type or funding source is refused (defends against a bad admin row)', () => {
  expectEqual(validate(baseCode({ type: 'bogus' })).ok, false, 'bad type');
  expectEqual(validate(baseCode({ fundingSource: 'nobody' })).ok, false, 'bad funding');
});

Deno.test('rejection messages: not-found / expired / scope all collapse to ONE generic message (no enumeration)', () => {
  const generic = 'This promo code is not valid.';
  expectEqual(promoRejectionMessage({ reason: 'not_found' }), generic, 'not_found');
  expectEqual(promoRejectionMessage({ reason: 'expired' }), generic, 'expired');
  expectEqual(promoRejectionMessage({ reason: 'wrong_restaurant' }), generic, 'scope');
  expectEqual(promoRejectionMessage({ reason: 'inactive' }), generic, 'inactive');
  // Only min_basket is specific — it is actionable and leaks nothing sensitive.
  const minMsg = promoRejectionMessage({ reason: 'min_basket', minBasket: 5000 });
  if (minMsg === generic || !minMsg.includes('5000')) {
    throw new Error(`min_basket message should be specific, got "${minMsg}"`);
  }
});

Deno.test('redemption messages map cap-reached and already-redeemed distinctly', () => {
  expectEqual(
    promoRedemptionMessage('global_cap_reached'),
    'This promo code has reached its usage limit.',
    'global cap'
  );
  expectEqual(promoRedemptionMessage('user_cap_reached'), 'This promo code has reached its usage limit.', 'user cap');
  expectEqual(
    promoRedemptionMessage('already_redeemed'),
    'This promo code was already applied to this order.',
    'already redeemed'
  );
  expectEqual(promoRedemptionMessage('anything_else'), 'This promo code is no longer available.', 'fallback');
});
