const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { initializePaystackTransaction } = await import('./paystack.ts');

const originalFetch = globalThis.fetch;
Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_123');
Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_123');

Deno.test('initializePaystackTransaction forwards split fields to Paystack', async () => {

  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(JSON.stringify({ status: true, data: { access_code: 'code-1' } }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  };

  try {
    await initializePaystackTransaction({
      amount: 13000,
      callbackUrl: 'https://example.test/payment/callback',
      email: 'customer@example.test',
      metadata: { orderId: 'order-1' },
      paymentMethod: 'card',
      reference: 'FEASTY-CRD-ORDER-1',
      subaccount: 'ACCT_split_123',
      transactionCharge: 2200,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!capturedBody) {
    throw new Error('Expected Paystack request body to be captured.');
  }

  expectEqual(capturedBody.subaccount, 'ACCT_split_123', 'subaccount');
  expectEqual(capturedBody.transaction_charge, '220000', 'transaction_charge');
});

Deno.test('initializePaystackTransaction omits split fields for manual settlement', async () => {
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(JSON.stringify({ status: true, data: { access_code: 'code-1' } }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  };

  try {
    await initializePaystackTransaction({
      amount: 13000,
      email: 'customer@example.test',
      metadata: { orderId: 'order-1' },
      paymentMethod: 'card',
      reference: 'FEASTY-CRD-ORDER-1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!capturedBody) {
    throw new Error('Expected Paystack request body to be captured.');
  }

  if ('subaccount' in capturedBody) {
    throw new Error(`Expected no subaccount field, got ${JSON.stringify(capturedBody.subaccount)}`);
  }
  if ('transaction_charge' in capturedBody) {
    throw new Error(`Expected no transaction_charge field, got ${JSON.stringify(capturedBody.transaction_charge)}`);
  }
});
