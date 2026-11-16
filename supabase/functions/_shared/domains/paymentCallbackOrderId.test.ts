// The Paystack callback URL must carry the order id. The client builds its
// callback before the order exists and Paystack returns with only
// reference/trxref, so without orderId on the URL the web callback screen had
// nothing to confirm ("the order id is missing", 2026-11-16).

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_123');
Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_123');
Deno.env.set('PAYSTACK_CALLBACK_URL', 'https://app.example.test/payment/callback');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');
const { buildPaystackCallbackUrlForOrder } = await import('../paystack.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const handler = ordersDomain.handlers.initializeCustomerPayment;
if (typeof handler !== 'function') {
  throw new Error('ordersDomain.handlers.initializeCustomerPayment is not registered.');
}

const CUSTOMER_CONTEXT = {
  email: 'customer@example.test',
  role: 'customer',
  token: 'fake-token',
  uid: 'customer-uid',
  userProfile: { uid: 'customer-uid', email: 'customer@example.test', role: 'customer', accountDisabled: false },
};

type Row = Record<string, unknown>;

const restaurant = (id: string, itemId: string, name: string): Row => ({
  id,
  isOpen: true,
  isPublished: true,
  menu: [{ category: 'Mains', items: [{ id: itemId, isAvailable: true, name: 'Dish', price: 2000 }] }],
  minOrder: 0,
  name,
  pausedUntil: null,
  supportsDelivery: true,
  supportsPickup: true,
});

const restaurants: Record<string, Row> = {
  'restaurant-1': restaurant('restaurant-1', 'item-1', 'Kitchen One'),
  'restaurant-2': restaurant('restaurant-2', 'item-2', 'Kitchen Two'),
};

// deno-lint-ignore no-explicit-any
const client = serviceClient as any;
const originalFrom = client.from;
const originalRpc = client.rpc;
const originalFetch = globalThis.fetch;

const installMocks = () => {
  const paystackBodies: Row[] = [];

  client.from = (table: string) => {
    let restaurantId: string | null = null;
    // deno-lint-ignore no-explicit-any
    const builder: any = {};
    for (const method of [
      'select', 'eq', 'neq', 'in', 'or', 'is', 'gte', 'lte', 'gt', 'lt', 'order', 'limit', 'range', 'returns',
      'filter', 'match', 'not', 'contains',
    ]) {
      builder[method] = (column?: unknown, value?: unknown) => {
        if (table === 'RestaurantRecord' && method === 'eq' && column === 'id') {
          restaurantId = String(value);
        }
        return builder;
      };
    }
    for (const method of ['insert', 'upsert', 'update', 'delete']) {
      builder[method] = () => builder;
    }
    const single = async () => ({
      data: table === 'RestaurantRecord' && restaurantId ? restaurants[restaurantId] ?? null : null,
      error: null,
    });
    builder.maybeSingle = single;
    builder.single = single;
    builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject);
    return builder;
  };

  client.rpc = async () => ({ data: null, error: null });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://api.paystack.co/transaction/initialize')) {
      paystackBodies.push(JSON.parse(String(init?.body ?? '{}')) as Row);
      return new Response(
        JSON.stringify({
          status: true,
          data: { access_code: 'code-1', authorization_url: 'https://checkout.paystack.com/code-1' },
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      );
    }
    return new Response('{}', { headers: { 'Content-Type': 'application/json' }, status: 200 });
  }) as typeof fetch;

  return {
    paystackBodies,
    restore: () => {
      client.from = originalFrom;
      client.rpc = originalRpc;
      globalThis.fetch = originalFetch;
    },
  };
};

const initialize = async (data: Row) => {
  // deno-lint-ignore no-explicit-any
  const response = await (handler as any)({
    context: CUSTOMER_CONTEXT,
    data,
    request: new Request('https://example.test/rpc', { method: 'POST' }),
  });
  const body = (await response.json()) as { data: { orderId: string } };
  return body.data;
};

const callbackOf = (body: Row | undefined) => {
  if (!body || typeof body.callback_url !== 'string') {
    throw new Error(`Expected a callback_url on the Paystack initialize body, got ${JSON.stringify(body)}`);
  }
  return new URL(body.callback_url);
};

Deno.test('initializeCustomerPayment: single checkout callback_url carries the returned orderId', async () => {
  const mocks = installMocks();
  try {
    const result = await initialize({
      callbackUrl: 'https://app.feasty.com.ng/payment/callback',
      fulfillmentType: 'pickup',
      items: [{ id: 'item-1', quantity: 1, restaurantId: 'restaurant-1' }],
      paymentMethod: 'bank_transfer',
      restaurantId: 'restaurant-1',
      tipAmount: 0,
    });

    expectEqual(mocks.paystackBodies.length, 1, 'one Paystack initialize call');
    const callback = callbackOf(mocks.paystackBodies[0]);
    expectEqual(callback.origin, 'https://app.feasty.com.ng', 'client origin kept');
    expectEqual(callback.pathname, '/payment/callback', 'callback path kept');
    expectEqual(callback.searchParams.get('orderId'), result.orderId, 'orderId on the callback');
  } finally {
    mocks.restore();
  }
});

Deno.test('initializeCustomerPayment: grouped checkout callback_url carries the same orderId the response returns', async () => {
  const mocks = installMocks();
  try {
    const result = await initialize({
      callbackUrl: 'https://app.feasty.com.ng/payment/callback',
      fulfillmentType: 'pickup',
      items: [
        { id: 'item-1', quantity: 1, restaurantId: 'restaurant-1' },
        { id: 'item-2', quantity: 1, restaurantId: 'restaurant-2' },
      ],
      paymentMethod: 'card',
      restaurantId: 'restaurant-1',
      tipAmount: 0,
    });

    expectEqual(mocks.paystackBodies.length, 1, 'one Paystack initialize call for the whole group');
    const callback = callbackOf(mocks.paystackBodies[0]);
    expectEqual(callback.searchParams.get('orderId'), result.orderId, 'group orderId on the callback');
  } finally {
    mocks.restore();
  }
});

Deno.test('initializeCustomerPayment: an attacker-supplied callback falls back to the configured URL, still with orderId', async () => {
  const mocks = installMocks();
  try {
    const result = await initialize({
      callbackUrl: 'https://evil.example/steal?orderId=attacker',
      fulfillmentType: 'pickup',
      items: [{ id: 'item-1', quantity: 1, restaurantId: 'restaurant-1' }],
      paymentMethod: 'card',
      restaurantId: 'restaurant-1',
      tipAmount: 0,
    });

    const callback = callbackOf(mocks.paystackBodies[0]);
    expectEqual(callback.origin, 'https://app.example.test', 'configured origin');
    expectEqual(callback.pathname, '/payment/callback', 'configured path');
    expectEqual(callback.searchParams.get('orderId'), result.orderId, 'server orderId, not the attacker one');
  } finally {
    mocks.restore();
  }
});

Deno.test('buildPaystackCallbackUrlForOrder replaces a client-supplied orderId and keeps other params', () => {
  const url = new URL(
    buildPaystackCallbackUrlForOrder('https://app.feasty.com.ng/payment/callback?orderId=forged&x=1', 'real-order')
  );
  expectEqual(url.searchParams.getAll('orderId').join(','), 'real-order', 'single, server-chosen orderId');
  expectEqual(url.searchParams.get('x'), '1', 'other params kept');
});

Deno.test('buildPaystackCallbackUrlForOrder adds orderId to an allow-listed app-scheme callback', () => {
  const url = new URL(buildPaystackCallbackUrlForOrder('feasty-customer:///payment/callback', 'order-9'));
  expectEqual(url.protocol, 'feasty-customer:', 'scheme kept');
  expectEqual(url.searchParams.get('orderId'), 'order-9', 'orderId added');
});
