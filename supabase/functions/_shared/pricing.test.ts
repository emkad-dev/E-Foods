import {
  DEFAULT_PRICING_CONFIG,
  calculateOrderPricing,
  parsePricingConfig,
  roundCurrency,
  toDisplayPrice,
} from './pricing.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

Deno.test('toDisplayPrice embeds 20% + flat 100 per unit', () => {
  expectEqual(toDisplayPrice(5000, DEFAULT_PRICING_CONFIG), 6100, 'spec worked example');
  expectEqual(toDisplayPrice(500, DEFAULT_PRICING_CONFIG), 700, 'cheap item');
});

Deno.test('toDisplayPrice rounds at kobo precision', () => {
  expectEqual(toDisplayPrice(333.33, DEFAULT_PRICING_CONFIG), 500, '333.33*1.2+100 = 499.996 → 500');
});

Deno.test('toDisplayPrice returns 0 for free or invalid base prices', () => {
  expectEqual(toDisplayPrice(0, DEFAULT_PRICING_CONFIG), 0, 'zero base');
  expectEqual(toDisplayPrice(-50, DEFAULT_PRICING_CONFIG), 0, 'negative base');
  expectEqual(toDisplayPrice(Number.NaN, DEFAULT_PRICING_CONFIG), 0, 'NaN base');
});

Deno.test('parsePricingConfig accepts a valid record', () => {
  const parsed = parsePricingConfig({ markupRate: 0.25, markupFlat: 50, partnerServiceRate: 0.05 });
  expectEqual(parsed.markupRate, 0.25, 'markupRate');
  expectEqual(parsed.markupFlat, 50, 'markupFlat');
  expectEqual(parsed.partnerServiceRate, 0.05, 'partnerServiceRate');
});

Deno.test('parsePricingConfig falls back to defaults on garbage', () => {
  for (const raw of [null, undefined, 'x', 42, {}, { markupRate: 'a' }, { markupRate: -1, markupFlat: 100, partnerServiceRate: 0.03 }, { markupRate: 0.2, markupFlat: 100, partnerServiceRate: 0.9 }]) {
    const parsed = parsePricingConfig(raw);
    expectEqual(parsed.markupRate, DEFAULT_PRICING_CONFIG.markupRate, `markupRate for ${JSON.stringify(raw)}`);
    expectEqual(parsed.markupFlat, DEFAULT_PRICING_CONFIG.markupFlat, `markupFlat for ${JSON.stringify(raw)}`);
    expectEqual(parsed.partnerServiceRate, DEFAULT_PRICING_CONFIG.partnerServiceRate, `partnerServiceRate for ${JSON.stringify(raw)}`);
  }
});

Deno.test('calculateOrderPricing matches the spec worked example (2 × ₦5,000 item)', () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: 800,
    items: [{ basePrice: 5000, price: 6100, quantity: 2 }],
    tip: 0,
  });
  expectEqual(pricing.subtotal, 12200, 'display subtotal');
  expectEqual(pricing.restaurantBasis, 10000, 'own-price basis');
  expectEqual(pricing.partnerServiceFee, 0, 'no partner service charge');
  expectEqual(pricing.restaurantPayable, 10000, 'restaurant keeps full own price');
  expectEqual(pricing.platformFee, 2200, 'embedded markup only');
  expectEqual(pricing.netSettlement, 10800, 'payable + delivery fee');
  expectEqual(pricing.serviceFee, 0, 'no customer service fee');
  expectEqual(pricing.total, 13000, 'subtotal + delivery + tip');
  expectEqual(pricing.currency, 'NGN', 'currency');
});

Deno.test('calculateOrderPricing honors a nonzero partnerServiceRate (future flexibility)', () => {
  const pricing = calculateOrderPricing({
    config: { markupRate: 0.2, markupFlat: 100, partnerServiceRate: 0.03 },
    deliveryFee: 0,
    items: [{ basePrice: 5000, price: 6100, quantity: 2 }],
    tip: 0,
  });
  expectEqual(pricing.partnerServiceFee, 300, '3% of basis');
  expectEqual(pricing.restaurantPayable, 9700, 'basis minus fee');
  expectEqual(pricing.platformFee, 2500, 'markup 2200 + fee 300');
});

Deno.test('calculateOrderPricing reconciles platformFee + restaurantPayable = subtotal', () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: 0,
    items: [
      { basePrice: 1234.56, price: toDisplayPrice(1234.56, DEFAULT_PRICING_CONFIG), quantity: 3 },
      { basePrice: 789.01, price: toDisplayPrice(789.01, DEFAULT_PRICING_CONFIG), quantity: 1 },
    ],
    tip: 100,
  });
  expectEqual(
    roundCurrency(pricing.platformFee + pricing.restaurantPayable),
    pricing.subtotal,
    'reconciliation'
  );
});

Deno.test('calculateOrderPricing handles an empty cart as zeros', () => {
  const pricing = calculateOrderPricing({ config: DEFAULT_PRICING_CONFIG, deliveryFee: 0, items: [], tip: 0 });
  expectEqual(pricing.total, 0, 'total');
  expectEqual(pricing.restaurantPayable, 0, 'payable');
  expectEqual(pricing.platformFee, 0, 'platformFee');
});

Deno.test('calculateOrderPricing clamps negative delivery fee and tip to 0', () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: -50,
    items: [{ basePrice: 1000, price: 1300, quantity: 1 }],
    tip: -10,
  });
  expectEqual(pricing.deliveryFee, 0, 'deliveryFee clamped');
  expectEqual(pricing.tip, 0, 'tip clamped');
  expectEqual(pricing.total, 1300, 'total');
});
