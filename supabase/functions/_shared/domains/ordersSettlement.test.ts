const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { noteManualSettlementFallback, resolvePaymentSettlementSummary } = await import('./orders.ts');

Deno.test('resolvePaymentSettlementSummary uses split when the restaurant has a payout code', () => {
  const summary = resolvePaymentSettlementSummary({ paystackSubaccountCode: 'ACCT_split_123' });

  expectEqual(summary.settlementMode, 'split', 'settlementMode');
  expectEqual(summary.splitSubaccountCode, 'ACCT_split_123', 'splitSubaccountCode');
});

Deno.test('resolvePaymentSettlementSummary stays manual when the restaurant has no payout code', () => {
  const summary = resolvePaymentSettlementSummary({ paystackSubaccountCode: null });

  expectEqual(summary.settlementMode, 'manual', 'settlementMode');
  expectEqual(summary.splitSubaccountCode, null, 'splitSubaccountCode');
});

Deno.test('resolvePaymentSettlementSummary keeps multi-store checkouts manual even with a payout code', () => {
  const summary = resolvePaymentSettlementSummary({ paystackSubaccountCode: 'ACCT_split_123' }, false);

  expectEqual(summary.settlementMode, 'manual', 'settlementMode');
  expectEqual(summary.splitSubaccountCode, null, 'splitSubaccountCode');
});

const fallbackInput = {
  isMultiStore: false,
  orderId: 'order-1',
  paymentReference: 'FEASTY-CRD-ORDER-1',
  restaurantId: 'rest-1',
  restaurantName: 'Mama Put',
  settlementMode: 'manual',
};

Deno.test('noteManualSettlementFallback alerts once per call for a single-store manual payment', async () => {
  const calls: unknown[] = [];
  await noteManualSettlementFallback(fallbackInput, async (input) => {
    calls.push(input);
    return [];
  });
  expectEqual(calls.length, 1, 'alert capture calls');
});

Deno.test('noteManualSettlementFallback does not alert for split payments or multi-store carts', async () => {
  const calls: unknown[] = [];
  const capture = async (input: unknown) => {
    calls.push(input);
    return [];
  };
  await noteManualSettlementFallback({ ...fallbackInput, settlementMode: 'split' }, capture);
  await noteManualSettlementFallback({ ...fallbackInput, isMultiStore: true }, capture);
  expectEqual(calls.length, 0, 'alert capture calls');
});

Deno.test('noteManualSettlementFallback never throws and never waits on a hung alert write', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await noteManualSettlementFallback(fallbackInput, () => Promise.reject(new Error('db down')));

    const startedAt = Date.now();
    await noteManualSettlementFallback(fallbackInput, () => new Promise(() => {}));
    const elapsed = Date.now() - startedAt;
    if (elapsed > 3000) throw new Error(`hung alert write delayed the caller by ${elapsed}ms`);
  } finally {
    console.error = originalConsoleError;
  }
});
