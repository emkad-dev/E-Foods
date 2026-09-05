const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { resolvePaymentSettlementSummary } = await import('./orders.ts');

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
