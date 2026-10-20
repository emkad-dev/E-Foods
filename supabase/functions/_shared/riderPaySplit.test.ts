// Rider pay, part 1: the Paystack split for both delivery modes.
//
// THE PIN. A restaurant-delivered single-store order must produce exactly the
// pricing object and exactly the Paystack initialize body it produced before
// platform delivery existed. Both are asserted against hand-written literals
// (not against another call of the same code), so any drift in key order,
// rounding or field presence fails here.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_123');
Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_123');

const {
  DEFAULT_PRICING_CONFIG,
  buildPaystackSplitFields,
  calculateOrderPricing,
  settlementBalanceResidual,
} = await import('./pricing.ts');
const { initializePaystackTransaction } = await import('./paystack.ts');
const {
  loadPlatformDispatchEnabled,
  loadRestaurantDeliveryProviders,
  normalizeDeliveryProvider,
  readOrderDeliveryProvider,
  resolveCheckoutDeliveryProvider,
} = await import('./deliveryProvider.ts');
const { resolveDispatchPoolForOrder } = await import('./dispatchSelection.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// 3000×1 → 3700 and 1500×2 → 1900 each: subtotal 7500, basis 6000, markup 1500.
const ITEMS = [
  { basePrice: 3000, price: 3700, quantity: 1 },
  { basePrice: 1500, price: 1900, quantity: 2 },
];
const DELIVERY_FEE = 800;
const TIP = 200;

const LEGACY_RESTAURANT_PRICING = {
  currency: 'NGN',
  deliveryFee: 800,
  discount: 0,
  discountFundingSource: null,
  dispatchFee: 800,
  netSettlement: 6800,
  partnerServiceFee: 0,
  platformFee: 1500,
  restaurantBasis: 6000,
  restaurantPayable: 6000,
  serviceFee: 0,
  settlement: {
    basis: 'menu_base_prices',
    discount: 0,
    discountFundingSource: null,
    dispatchFee: 800,
    markupFlat: 100,
    markupRate: 0.2,
    netSettlement: 6800,
    partnerServiceFee: 0,
    partnerServiceRate: 0,
    platformFee: 1500,
    restaurantBasis: 6000,
    restaurantPayable: 6000,
    totalMarkup: 1500,
  },
  subtotal: 7500,
  tip: 200,
  total: 8500,
};

const captureInitializeBody = async (input: Parameters<typeof initializePaystackTransaction>[0]) => {
  const bodies: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ status: true, data: { access_code: 'code-1' } }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }) as typeof fetch;
  try {
    await initializePaystackTransaction(input);
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (!bodies[0]) {
    throw new Error('no Paystack body captured');
  }
  return bodies[0];
};

Deno.test('restaurant delivery: pricing object is byte-for-byte the legacy shape (default and explicit)', () => {
  const implicit = calculateOrderPricing({ config: DEFAULT_PRICING_CONFIG, deliveryFee: DELIVERY_FEE, items: ITEMS, tip: TIP });
  const explicit = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: DELIVERY_FEE,
    deliveryProvider: 'restaurant',
    items: ITEMS,
    tip: TIP,
  });
  expectEqual(JSON.stringify(implicit), JSON.stringify(LEGACY_RESTAURANT_PRICING), 'implicit restaurant pricing');
  expectEqual(JSON.stringify(explicit), JSON.stringify(LEGACY_RESTAURANT_PRICING), 'explicit restaurant pricing');
});

Deno.test('restaurant delivery: the single-store Paystack initialize body is pinned byte-for-byte', async () => {
  const pricing = calculateOrderPricing({ config: DEFAULT_PRICING_CONFIG, deliveryFee: DELIVERY_FEE, items: ITEMS, tip: TIP });
  const split = buildPaystackSplitFields({ pricing, settlementMode: 'split', splitSubaccountCode: 'ACCT_rest_1' });
  expectEqual(split.subaccount, 'ACCT_rest_1', 'subaccount');
  expectEqual(split.transactionCharge, 1700, 'platform keeps markup + tip only');

  const body = await captureInitializeBody({
    amount: pricing.total,
    callbackUrl: 'https://example.test/payment/callback',
    email: 'customer@example.test',
    metadata: { orderId: 'order-1' },
    paymentMethod: 'card',
    reference: 'FEASTY-CRD-ORDER0001-1',
    subaccount: split.subaccount,
    transactionCharge: split.transactionCharge,
  });

  const expected = JSON.stringify({
    amount: '850000',
    channels: ['card'],
    currency: 'NGN',
    email: 'customer@example.test',
    metadata: '{"orderId":"order-1"}',
    reference: 'FEASTY-CRD-ORDER0001-1',
    subaccount: 'ACCT_rest_1',
    transaction_charge: '170000',
    callback_url: 'https://example.test/payment/callback',
  });
  expectEqual(body, expected, 'Paystack body');
});

Deno.test('platform delivery: the restaurant subaccount receives dishes only; fee and tip stay with the platform', async () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: DELIVERY_FEE,
    deliveryProvider: 'platform',
    items: ITEMS,
    tip: TIP,
  });
  expectEqual(pricing.total, 8500, 'customer pays exactly the same total');
  expectEqual(pricing.netSettlement, 6000, 'restaurant gets restaurantPayable only');
  expectEqual(pricing.settlement.netSettlement, 6000, 'settlement.netSettlement too');
  expectEqual(pricing.deliveryProvider, 'platform', 'stamp at top level (read by dispatch + earning trigger)');
  expectEqual(pricing.settlement.deliveryProvider, 'platform', 'stamp in settlement');
  expectEqual(pricing.platformDeliveryFee, 800, 'platform retains the fee');
  expectEqual(pricing.riderDeliveryPay, 800, 'rider owed the full fee');
  expectEqual(pricing.dispatchFee, 800, 'dispatchFee unchanged (CourierEarning reads it)');
  expectEqual(settlementBalanceResidual(pricing), 0, 'balances to the kobo');

  const split = buildPaystackSplitFields({ pricing, settlementMode: 'split', splitSubaccountCode: 'ACCT_rest_1' });
  expectEqual(split.transactionCharge, 2500, 'platform keeps markup 1500 + fee 800 + tip 200');

  const body = JSON.parse(
    await captureInitializeBody({
      amount: pricing.total,
      email: 'customer@example.test',
      metadata: { orderId: 'order-1' },
      paymentMethod: 'card',
      reference: 'FEASTY-CRD-ORDER0001-1',
      subaccount: split.subaccount,
      transactionCharge: split.transactionCharge,
    })
  ) as Record<string, unknown>;
  expectEqual(body.amount, '850000', 'amount');
  expectEqual(body.transaction_charge, '250000', 'transaction_charge in kobo');
  expectEqual(body.subaccount, 'ACCT_rest_1', 'still split to the restaurant');
});

Deno.test('manual settlement sends no split fields in either mode', () => {
  for (const deliveryProvider of ['restaurant', 'platform'] as const) {
    const pricing = calculateOrderPricing({
      config: DEFAULT_PRICING_CONFIG,
      deliveryFee: DELIVERY_FEE,
      deliveryProvider,
      items: ITEMS,
      tip: TIP,
    });
    const split = buildPaystackSplitFields({ pricing, settlementMode: 'manual', splitSubaccountCode: null });
    expectEqual(split.subaccount, null, `${deliveryProvider}: no subaccount`);
    expectEqual(split.transactionCharge, null, `${deliveryProvider}: no transaction_charge`);
  }
});

Deno.test('platform delivery with promos: every funding source balances and the rider is never short', () => {
  const cases = [
    { fundingSource: 'restaurant', type: 'free_delivery', value: 0 },
    { fundingSource: 'restaurant', type: 'free_delivery', value: 300 },
    { fundingSource: 'platform', type: 'free_delivery', value: 0 },
    { fundingSource: 'restaurant', type: 'percent', value: 10 },
    { fundingSource: 'platform', type: 'fixed', value: 500 },
  ] as const;

  for (const discount of cases) {
    const label = `${discount.fundingSource}/${discount.type}/${discount.value}`;
    const pricing = calculateOrderPricing({
      config: DEFAULT_PRICING_CONFIG,
      deliveryFee: DELIVERY_FEE,
      deliveryProvider: 'platform',
      discount,
      items: ITEMS,
      tip: TIP,
    });
    expectEqual(settlementBalanceResidual(pricing), 0, `${label}: balances`);
    expectEqual(pricing.riderDeliveryPay, 800, `${label}: rider still owed the full fee`);
    expectEqual(pricing.netSettlement, pricing.restaurantPayable, `${label}: restaurant never gets the fee`);
    if (discount.fundingSource === 'restaurant' && discount.type === 'free_delivery') {
      // The waiver comes out of the restaurant's dishes, not a fee it never had.
      expectEqual(pricing.restaurantPayable, 6000 - pricing.discount, `${label}: restaurant funds the waiver`);
      expectEqual(pricing.platformFee, 1500, `${label}: platform take untouched`);
    }
  }
});

Deno.test('restaurant delivery with a restaurant-funded free delivery is unchanged (comes off the fee it receives)', () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: DELIVERY_FEE,
    discount: { fundingSource: 'restaurant', type: 'free_delivery', value: 0 },
    items: ITEMS,
    tip: TIP,
  });
  expectEqual(pricing.netSettlement, 6000, 'fee waived out of the restaurant dispatch share');
  expectEqual(pricing.settlement.dispatchFee, 0, 'net dispatch fee 0');
  expectEqual('deliveryProvider' in pricing, false, 'no stamp on restaurant orders');
  expectEqual(settlementBalanceResidual(pricing), 0, 'balances');
});

Deno.test('checkout decision: platform only for delivery + flag on + restaurant opted in', () => {
  const decide = (fulfillmentType: string, platformDispatchEnabled: boolean, restaurantSetting: unknown) =>
    resolveCheckoutDeliveryProvider({ fulfillmentType, platformDispatchEnabled, restaurantSetting });
  expectEqual(decide('delivery', true, 'platform'), 'platform', 'all three');
  expectEqual(decide('delivery', false, 'platform'), 'restaurant', 'flag off');
  expectEqual(decide('pickup', true, 'platform'), 'restaurant', 'pickup');
  expectEqual(decide('delivery', true, 'restaurant'), 'restaurant', 'not opted in');
  expectEqual(decide('delivery', true, null), 'restaurant', 'column missing');
  expectEqual(decide('delivery', true, 'PLATFORM'), 'restaurant', 'exact match only');
  expectEqual(normalizeDeliveryProvider(' platform '), 'platform', 'trimmed');
});

Deno.test('order stamp read and dispatch pool follow the same provider', () => {
  expectEqual(readOrderDeliveryProvider({ deliveryProvider: 'platform' }), 'platform', 'stamped');
  expectEqual(readOrderDeliveryProvider({ total: 1 }), 'restaurant', 'legacy unstamped');
  expectEqual(readOrderDeliveryProvider(null), 'restaurant', 'null pricing');
  expectEqual(resolveDispatchPoolForOrder({ deliveryProvider: 'platform' }), 'global', 'platform → global pool only');
  expectEqual(resolveDispatchPoolForOrder({}), 'restaurant', 'restaurant → own riders only');
  expectEqual(resolveDispatchPoolForOrder(undefined), 'restaurant', 'no pricing → own riders only');
});

Deno.test('provider lookups fail closed to restaurant delivery (safe before the migration lands)', async () => {
  const erroringClient = {
    from: () => ({
      select: () => ({
        in: async () => ({ data: null, error: { message: 'column RestaurantRecord.deliveryProvider does not exist' } }),
      }),
    }),
  };
  const providers = await loadRestaurantDeliveryProviders(['r1', 'r2'], erroringClient as never);
  expectEqual(providers.get('r1'), 'restaurant', 'r1 falls back');
  expectEqual(providers.get('r2'), 'restaurant', 'r2 falls back');

  const okClient = {
    from: () => ({
      select: () => ({
        in: async () => ({ data: [{ deliveryProvider: 'platform', id: 'r1' }, { deliveryProvider: null, id: 'r2' }], error: null }),
      }),
    }),
  };
  const read = await loadRestaurantDeliveryProviders(['r1', 'r2'], okClient as never);
  expectEqual(read.get('r1'), 'platform', 'opted in');
  expectEqual(read.get('r2'), 'restaurant', 'null column');

  expectEqual(
    await loadPlatformDispatchEnabled(async () => {
      throw new Error('FeatureFlag unreadable');
    }),
    false,
    'unreadable flags = platform dispatch off'
  );
  expectEqual(await loadPlatformDispatchEnabled(async () => ({ platform_dispatch: true })), true, 'flag on');
});
