const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { getNormalizedPaystackCallbackUrl, initializePaystackTransaction } = await import('./paystack.ts');

const originalFetch = globalThis.fetch;
Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_123');
Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_123');

Deno.test('initializePaystackTransaction forwards split fields to Paystack', async () => {

  // Collected rather than held in a `let`: TypeScript's control-flow
  // analysis cannot see an assignment made from inside the fetch stub, so a
  // nullable `let` stays narrowed to `null` and every guarded read below
  // resolves to `never`. Reading element 0 of a typed array has no such
  // problem and keeps the assertions honest.
  const capturedBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    capturedBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
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

  const body = capturedBodies[0];

  if (!body) {
    throw new Error('Expected Paystack request body to be captured.');
  }

  expectEqual(body.subaccount, 'ACCT_split_123', 'subaccount');
  expectEqual(body.transaction_charge, '220000', 'transaction_charge');
});

Deno.test('initializePaystackTransaction omits split fields for manual settlement', async () => {
  // Collected rather than held in a `let`: TypeScript's control-flow
  // analysis cannot see an assignment made from inside the fetch stub, so a
  // nullable `let` stays narrowed to `null` and every guarded read below
  // resolves to `never`. Reading element 0 of a typed array has no such
  // problem and keeps the assertions honest.
  const capturedBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    capturedBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
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

  const body = capturedBodies[0];

  if (!body) {
    throw new Error('Expected Paystack request body to be captured.');
  }

  if ('subaccount' in body) {
    throw new Error(`Expected no subaccount field, got ${JSON.stringify(body.subaccount)}`);
  }
  if ('transaction_charge' in body) {
    throw new Error(`Expected no transaction_charge field, got ${JSON.stringify(body.transaction_charge)}`);
  }
});

// Open-redirect guard: an http(s) callback is honoured only on a host we serve.
const CONFIGURED_CALLBACK = 'https://configured.example.test/payment/callback';

const withConfiguredCallback = (run: () => void) => {
  const previous = Deno.env.get('PAYSTACK_CALLBACK_URL');
  Deno.env.set('PAYSTACK_CALLBACK_URL', CONFIGURED_CALLBACK);
  try {
    run();
  } finally {
    if (previous === undefined) {
      Deno.env.delete('PAYSTACK_CALLBACK_URL');
    } else {
      Deno.env.set('PAYSTACK_CALLBACK_URL', previous);
    }
  }
};

Deno.test('getNormalizedPaystackCallbackUrl: a foreign host on /payment/callback falls back to the configured URL', () => {
  withConfiguredCallback(() => {
    for (const foreign of [
      'https://evil.example/payment/callback',
      'https://app.feasty.com.ng.evil.example/payment/callback',
      'https://evilfeasty.com.ng/payment/callback',
      'https://app.feasty.com.ng:8443/payment/callback',
      'http://localhost.evil.example/payment/callback',
    ]) {
      expectEqual(getNormalizedPaystackCallbackUrl(foreign), CONFIGURED_CALLBACK, foreign);
    }
  });
});

Deno.test('getNormalizedPaystackCallbackUrl: each allowed host is kept', () => {
  withConfiguredCallback(() => {
    for (const allowed of [
      'https://configured.example.test/payment/callback',
      'https://app.feasty.com.ng/payment/callback',
      'https://feasty.com.ng/payment/callback',
      'https://www.feasty.com.ng/payment/callback',
      'http://localhost:8081/payment/callback',
      'http://127.0.0.1:19006/payment/callback',
      'http://localhost/payment/callback',
    ]) {
      expectEqual(getNormalizedPaystackCallbackUrl(allowed), new URL(allowed).toString(), allowed);
    }
  });
});

Deno.test('getNormalizedPaystackCallbackUrl: the feasty-customer scheme branch is unchanged', () => {
  withConfiguredCallback(() => {
    expectEqual(
      getNormalizedPaystackCallbackUrl('feasty-customer:///payment/callback'),
      'feasty-customer:///payment/callback',
      'app scheme kept'
    );
  });
});
