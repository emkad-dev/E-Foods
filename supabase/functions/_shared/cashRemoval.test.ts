// SP-4 cash-removal tests: verify that 'cash' is rejected at the payment
// method validation gate (400) and that the placeCustomerOrder handler is
// a stub returning 410 for all inputs.
//
// Uses the --no-check invocation in test:deno because the domain modules
// statically import _shared/client.ts, which throws at module scope without
// SUPABASE_URL / SERVICE_ROLE_KEY set first.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
// Paystack keys needed so assertPaystackConfigured() in initializeCustomerPayment
// passes and prepareCustomerOrderDraft is actually called (the validation gate
// we want to exercise is inside that function, after the Paystack check).
Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_fake_cash_removal_test');
Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_fake_cash_removal_test');

const { ordersDomain } = await import('./domains/orders.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const CUSTOMER_CONTEXT = {
  email: 'customer@example.test',
  role: 'customer',
  token: 'fake-token',
  uid: 'customer-uid',
  userProfile: { uid: 'customer-uid', email: 'customer@example.test', role: 'customer', accountDisabled: false },
};

// --- 1. Payment method validation gate rejects 'cash' with 400 -------------
//
// initializeCustomerPayment calls prepareCustomerOrderDraft after passing
// assertPaystackConfigured(). With the validation gate now excluding 'cash'
// from the allowed set, a 'cash' request fails before any DB access.
Deno.test('validateOrderData: paymentMethod cash is rejected with 400 (removed from allowed methods)', async () => {
  const handler = ordersDomain.handlers.initializeCustomerPayment;
  if (typeof handler !== 'function') {
    throw new Error('ordersDomain.handlers.initializeCustomerPayment is not registered.');
  }

  let thrown: unknown = null;
  try {
    // deno-lint-ignore no-explicit-any
    await (handler as any)({
      context: CUSTOMER_CONTEXT,
      data: {
        restaurantId: 'test-restaurant',
        fulfillmentType: 'delivery',
        paymentMethod: 'cash',
        items: [{ id: 'item-1', quantity: 1 }],
      },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  expectEqual(thrown instanceof Error, true, 'cash payment method should throw');
  expectEqual(
    (thrown as { status?: number })?.status,
    400,
    'unsupported payment method → 400'
  );
  expectEqual(
    (thrown as Error)?.message,
    'Unsupported payment method.',
    'client-safe rejection message'
  );
});

// --- 2. placeCustomerOrder is a stub returning 410 -------------------------
//
// The RPC action is kept in the route map so old clients receive a clear 410
// rejection rather than an unknown-action error.
Deno.test('placeCustomerOrder: handler is a stub returning 410 for any input', async () => {
  const handler = ordersDomain.handlers.placeCustomerOrder;
  if (typeof handler !== 'function') {
    throw new Error('ordersDomain.handlers.placeCustomerOrder is not registered.');
  }

  let thrown: unknown = null;
  try {
    // deno-lint-ignore no-explicit-any
    await (handler as any)({
      context: CUSTOMER_CONTEXT,
      data: {
        restaurantId: 'test-restaurant',
        fulfillmentType: 'delivery',
        paymentMethod: 'cash',
        items: [{ id: 'item-1', quantity: 1 }],
      },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  expectEqual(thrown instanceof Error, true, 'stub should throw');
  expectEqual((thrown as { status?: number })?.status, 410, 'stub status is 410');
  expectEqual(
    (thrown as Error)?.message,
    'Cash payments are no longer accepted. Please use card or bank transfer.',
    'stub message is the client-safe cash-removal copy'
  );
});

// --- 3. placeCustomerOrder rejects even with non-cash inputs ----------------
//
// The stub returns 410 for ANY input — not just cash. There is no cash UI in
// the customer app; this confirms old card/bank_transfer clients (if any) that
// somehow hit this RPC action also get a clear message.
Deno.test('placeCustomerOrder: stub returns 410 even for card payment method', async () => {
  const handler = ordersDomain.handlers.placeCustomerOrder;
  if (typeof handler !== 'function') {
    throw new Error('ordersDomain.handlers.placeCustomerOrder is not registered.');
  }

  let thrown: unknown = null;
  try {
    // deno-lint-ignore no-explicit-any
    await (handler as any)({
      context: CUSTOMER_CONTEXT,
      data: {
        restaurantId: 'test-restaurant',
        fulfillmentType: 'delivery',
        paymentMethod: 'card',
        items: [{ id: 'item-1', quantity: 1 }],
      },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 410, 'stub always returns 410');
});
