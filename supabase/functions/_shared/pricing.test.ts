import {
  DEFAULT_PRICING_CONFIG,
  calculateOrderPricing,
  parsePricingConfig,
  roundCurrency,
  settlementBalanceResidual,
  toDisplayPrice,
  type ResolvedDiscount,
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
  for (
    const raw of [
      null,
      undefined,
      'x',
      42,
      {},
      { markupRate: 'a' },
      { markupRate: -1, markupFlat: 100, partnerServiceRate: 0.03 },
      { markupRate: 0.2, markupFlat: 100, partnerServiceRate: 0.9 },
      // Nullish/empty/boolean/array FIELDS. Number(x) is 0 - and therefore
      // finite and in range - for every one of these, so a Number()-based guard
      // reads them as a configured zero and skips this fallback entirely. The
      // first entry is the live-shaped row that would silently erase the flat
      // ₦100/unit platform markup on every order.
      { markupRate: 0.2, markupFlat: null, partnerServiceRate: 0 },
      { markupRate: null, markupFlat: null, partnerServiceRate: null },
      { markupRate: null, markupFlat: 100, partnerServiceRate: 0 },
      { markupRate: 0.2, markupFlat: '', partnerServiceRate: 0 },
      { markupRate: 0.2, markupFlat: '   ', partnerServiceRate: 0 },
      { markupRate: 0.2, markupFlat: 100, partnerServiceRate: null },
      { markupRate: false, markupFlat: 100, partnerServiceRate: 0 },
      { markupRate: 0.2, markupFlat: [], partnerServiceRate: 0 },
      { markupRate: 0.2, markupFlat: 100 },
      { markupFlat: 100, partnerServiceRate: 0 },
    ]
  ) {
    const parsed = parsePricingConfig(raw);
    expectEqual(parsed.markupRate, DEFAULT_PRICING_CONFIG.markupRate, `markupRate for ${JSON.stringify(raw)}`);
    expectEqual(parsed.markupFlat, DEFAULT_PRICING_CONFIG.markupFlat, `markupFlat for ${JSON.stringify(raw)}`);
    expectEqual(parsed.partnerServiceRate, DEFAULT_PRICING_CONFIG.partnerServiceRate, `partnerServiceRate for ${JSON.stringify(raw)}`);
  }
});

// The guard above must reject ABSENT, not zero: partnerServiceRate is a
// deliberately-configured 0 in production today, so a fix that treats every 0
// as "missing" would be its own outage.
Deno.test('parsePricingConfig keeps a genuinely configured zero', () => {
  const zeroed = parsePricingConfig({ markupRate: 0, markupFlat: 0, partnerServiceRate: 0 });
  expectEqual(zeroed.markupRate, 0, 'explicit zero markupRate is honoured');
  expectEqual(zeroed.markupFlat, 0, 'explicit zero markupFlat is honoured');
  expectEqual(zeroed.partnerServiceRate, 0, 'explicit zero partnerServiceRate is honoured');

  const live = parsePricingConfig({ markupRate: 0.2, markupFlat: 100, partnerServiceRate: 0 });
  expectEqual(live.markupFlat, 100, 'the live config still parses');
  expectEqual(live.partnerServiceRate, 0, 'the live zero partner rate still parses');
});

Deno.test('parsePricingConfig still accepts numeric strings', () => {
  const parsed = parsePricingConfig({ markupRate: '0.25', markupFlat: '50', partnerServiceRate: '0' });
  expectEqual(parsed.markupRate, 0.25, 'string markupRate');
  expectEqual(parsed.markupFlat, 50, 'string markupFlat');
  expectEqual(parsed.partnerServiceRate, 0, 'string partnerServiceRate');
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

// ===========================================================================
// Task 17 (G1): the discount + settlement split. Reference basket throughout:
//   2 × (base 5000 → display 6100)  ⇒ subtotal 12200, restaurantBasis 10000,
//   markup/platformFeeBase 2200, restaurantPayableBase 10000, delivery 800.
//   Base (no discount): netSettlement 10800, platformFee 2200, total 13000.
// The enforced invariant, to the kobo, for EVERY case:
//   netSettlement + platformFee + tip === total   (settlementBalanceResidual 0)
// ===========================================================================

const REF_ITEMS = [{ basePrice: 5000, price: 6100, quantity: 2 }];
const REF_DELIVERY = 800;

const priceWith = (discount: ResolvedDiscount | null, tip = 0) =>
  calculateOrderPricing({ config: DEFAULT_PRICING_CONFIG, deliveryFee: REF_DELIVERY, discount, items: REF_ITEMS, tip });

const expectBalanced = (pricing: ReturnType<typeof calculateOrderPricing>, label: string) =>
  expectEqual(settlementBalanceResidual(pricing), 0, `${label}: settlement balances to the kobo`);

Deno.test('discount: no discount leaves the settlement identical and balanced', () => {
  const pricing = priceWith(null);
  expectEqual(pricing.discount, 0, 'discount 0');
  expectEqual(pricing.netSettlement, 10800, 'netSettlement unchanged');
  expectEqual(pricing.platformFee, 2200, 'platformFee unchanged');
  expectEqual(pricing.total, 13000, 'total unchanged');
  expectBalanced(pricing, 'no discount');
});

Deno.test('discount: PLATFORM-funded percent leaves netSettlement whole and comes off platformFee', () => {
  const pricing = priceWith({ type: 'percent', value: 10, fundingSource: 'platform' });
  expectEqual(pricing.discount, 1220, '10% of 12200');
  expectEqual(pricing.netSettlement, 10800, 'restaurant + delivery UNCHANGED (platform absorbs)');
  expectEqual(pricing.platformFee, 980, 'platformFee reduced by the discount');
  expectEqual(pricing.total, 11780, 'total = 13000 − 1220');
  expectBalanced(pricing, 'platform percent');
});

Deno.test('discount: RESTAURANT-funded percent reduces netSettlement and leaves platformFee whole', () => {
  const pricing = priceWith({ type: 'percent', value: 10, fundingSource: 'restaurant' });
  expectEqual(pricing.discount, 1220, '10% of 12200');
  expectEqual(pricing.restaurantPayable, 8780, 'restaurant dish payable reduced by the discount');
  expectEqual(pricing.netSettlement, 9580, 'netSettlement reduced (8780 + 800 delivery)');
  expectEqual(pricing.platformFee, 2200, 'platform take UNCHANGED');
  expectEqual(pricing.total, 11780, 'total = 13000 − 1220');
  expectBalanced(pricing, 'restaurant percent');
});

Deno.test('discount: a fixed discount never exceeds the subtotal, and a platform-funded one never drives platformFee net-negative', () => {
  // Fixed 20000 ≫ subtotal 12200 AND ≫ platform take 2200. Clamped to the
  // platform's take so the platform floors at 0 and the restaurant is paid full.
  const pricing = priceWith({ type: 'fixed', value: 20000, fundingSource: 'platform' });
  expectEqual(pricing.discount, 2200, 'clamped to the platform take (never > subtotal, never net-negative)');
  if (pricing.discount > pricing.subtotal) {
    throw new Error('discount must never exceed subtotal');
  }
  expectEqual(pricing.platformFee, 0, 'platformFee floors at 0');
  expectEqual(pricing.netSettlement, 10800, 'restaurant paid in full');
  expectEqual(pricing.total, 10800, 'total = 13000 − 2200');
  expectBalanced(pricing, 'over-sized platform fixed');
});

Deno.test('discount: a RESTAURANT-funded discount is capped at the restaurant\'s own payable', () => {
  // Fixed 15000 clamps at subtotal (12200) then at the restaurant payable (10000).
  const pricing = priceWith({ type: 'fixed', value: 15000, fundingSource: 'restaurant' });
  expectEqual(pricing.discount, 10000, 'capped at the restaurant payable');
  if (pricing.discount > pricing.subtotal) {
    throw new Error('discount must never exceed subtotal');
  }
  expectEqual(pricing.restaurantPayable, 0, 'restaurant dish payable floors at 0');
  expectEqual(pricing.netSettlement, 800, 'only the delivery fee remains');
  expectEqual(pricing.platformFee, 2200, 'platform take UNCHANGED');
  expectEqual(pricing.total, 3000, 'total = 13000 − 10000');
  expectBalanced(pricing, 'over-sized restaurant fixed');
});

Deno.test('discount: a moderate fixed restaurant-funded discount reduces only the dish payable', () => {
  const pricing = priceWith({ type: 'fixed', value: 5000, fundingSource: 'restaurant' });
  expectEqual(pricing.discount, 5000, 'applied in full (within payable)');
  expectEqual(pricing.restaurantPayable, 5000, 'dish payable reduced by 5000');
  expectEqual(pricing.netSettlement, 5800, '5000 + 800 delivery');
  expectEqual(pricing.platformFee, 2200, 'platform take UNCHANGED');
  expectEqual(pricing.total, 8000, 'total = 13000 − 5000');
  expectBalanced(pricing, 'restaurant fixed');
});

Deno.test('discount: PLATFORM-funded free_delivery caps at the delivery fee and the restaurant keeps its dispatch fee', () => {
  const pricing = priceWith({ type: 'free_delivery', value: 0, fundingSource: 'platform' });
  expectEqual(pricing.discount, 800, 'waives exactly the delivery fee');
  expectEqual(pricing.netSettlement, 10800, 'restaurant keeps dish payable AND delivery (platform absorbs)');
  expectEqual(pricing.platformFee, 1400, 'platformFee reduced by the delivery fee');
  expectEqual(pricing.total, 12200, 'total = 13000 − 800');
  expectBalanced(pricing, 'platform free delivery');
});

Deno.test('discount: RESTAURANT-funded free_delivery comes off the dispatch fee, platform take whole', () => {
  const pricing = priceWith({ type: 'free_delivery', value: 0, fundingSource: 'restaurant' });
  expectEqual(pricing.discount, 800, 'waives exactly the delivery fee');
  expectEqual(pricing.restaurantPayable, 10000, 'dish payable UNCHANGED (only delivery is waived)');
  expectEqual(pricing.netSettlement, 10000, 'delivery portion removed from netSettlement');
  expectEqual(pricing.settlement.dispatchFee, 0, 'the net dispatch fee the restaurant receives is 0');
  expectEqual(pricing.platformFee, 2200, 'platform take UNCHANGED');
  expectEqual(pricing.total, 12200, 'total = 13000 − 800');
  expectBalanced(pricing, 'restaurant free delivery');
});

Deno.test('discount: a free_delivery discount never exceeds the delivery fee even with a large value', () => {
  const pricing = priceWith({ type: 'free_delivery', value: 5000, fundingSource: 'platform' });
  expectEqual(pricing.discount, 800, 'capped at the 800 delivery fee, not 5000');
  expectBalanced(pricing, 'free delivery cap');
});

Deno.test('discount: total floors at 0 and stays balanced when the discount would exceed everything', () => {
  // Small basket so the funder cap is tiny; verify no negative total and balance.
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: 0,
    discount: { type: 'percent', value: 100, fundingSource: 'restaurant' },
    items: [{ basePrice: 1000, price: 1300, quantity: 1 }],
    tip: 0,
  });
  if (pricing.total < 0) {
    throw new Error('total must never be negative');
  }
  expectBalanced(pricing, 'floored total');
});
