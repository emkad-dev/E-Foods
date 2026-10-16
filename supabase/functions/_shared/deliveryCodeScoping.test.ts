// SP-2 Task 2: the proof-of-delivery code is customer-only.
//
// - customerGetOrderDetail returns it to the order's own customer while the
//   order is live, and hides it once the order is terminal.
// - No rider-facing response (dispatchGetDeliveryQueue, dispatchGetOrderDetail)
//   carries it anywhere. These are handler-level checks against the REAL
//   handlers with a fake serviceClient, asserted on the serialized payload so a
//   leak under any field name is caught.
//
// Env stubs are set before the dynamic imports because _shared/client.ts
// throws at module scope without them (see adminSetRestaurantPublished.test.ts).
// Runs in package.json's --no-check invocation.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./domains/orders.ts');
const { dispatchDomain } = await import('./domains/dispatch.ts');
const { serviceClient } = await import('./client.ts');

const CODE = '4821';
const CUSTOMER_UID = 'customer-1';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const contextFor = (role: string, uid: string) => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

const buildOrder = (status: string) => ({
  id: 'order-1',
  customerId: CUSTOMER_UID,
  restaurantId: 'restaurant-1',
  restaurantName: 'Test Kitchen',
  fulfillmentType: 'delivery',
  status,
  deliveryAddress: '1 Test Street',
  deliveryLocation: null,
  deliveryCode: CODE,
  deliveryCodeVerifiedAt: null,
  deliveryCodeAttempts: 0,
  payment: { method: 'cash', status: 'pending' },
  pricing: { total: 1000 },
  timeline: {},
  cancellation: null,
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
});

/**
 * A chainable, awaitable query-builder fake. CustomerOrder returns the one
 * order; every other table is empty. Filters are ignored - there is a single
 * order, so any lookup by id resolves to it.
 */
const installFake = (order: Record<string, unknown>) => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const rows = table === 'CustomerOrder' ? [order] : [];
    // deno-lint-ignore no-explicit-any
    const builder: any = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'then') {
            return (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            return async () => ({ data: rows[0] ?? null, error: null });
          }
          return () => builder;
        },
      }
    );
    return builder;
  };
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async () => ({ data: null, error: null });
};

const call = async (
  // deno-lint-ignore no-explicit-any
  handlers: Record<string, any>,
  name: string,
  role: string,
  uid: string,
  data: Record<string, unknown>
) => {
  const handler = handlers[name];
  if (typeof handler !== 'function') {
    throw new Error(`${name} is not registered.`);
  }
  const response: Response = await handler({ context: contextFor(role, uid), data, request: fakeRequest() });
  expectEqual(response.status, 200, `${name} status`);
  const text = await response.text();
  return { body: JSON.parse(text), text };
};

Deno.test('customerGetOrderDetail: the owner sees the delivery code on a live order', async () => {
  installFake(buildOrder('preparing'));
  const { body } = await call(ordersDomain.handlers, 'customerGetOrderDetail', 'customer', CUSTOMER_UID, {
    orderId: 'order-1',
  });
  expectEqual(body?.data?.order?.deliveryCode, CODE, 'owner receives the stored code');
});

Deno.test('customerGetOrderDetail: the code is hidden once the order is terminal', async () => {
  installFake(buildOrder('delivered'));
  const { body, text } = await call(ordersDomain.handlers, 'customerGetOrderDetail', 'customer', CUSTOMER_UID, {
    orderId: 'order-1',
  });
  expectEqual(body?.data?.order?.deliveryCode ?? null, null, 'delivered order carries no code');
  expectEqual(text.includes(CODE), false, 'delivered response does not contain the code string');
});

Deno.test('customerGetOrderDetail: another customer is refused with 403', async () => {
  installFake(buildOrder('preparing'));
  let thrown: unknown = null;
  try {
    await ordersDomain.handlers.customerGetOrderDetail({
      context: contextFor('customer', 'someone-else'),
      data: { orderId: 'order-1' },
      request: fakeRequest(),
    });
  } catch (error) {
    thrown = error;
  }
  expectEqual((thrown as { status?: number })?.status, 403, 'non-owner status');
});

Deno.test('customerGetOrderDetail: an admin viewing the order does not get the code', async () => {
  installFake(buildOrder('preparing'));
  const { text } = await call(ordersDomain.handlers, 'customerGetOrderDetail', 'admin', 'admin-uid', {
    orderId: 'order-1',
  });
  expectEqual(text.includes(CODE), false, 'admin response does not contain the code string');
});

Deno.test('dispatchGetDeliveryQueue: no rider-facing field carries the code', async () => {
  installFake(buildOrder('preparing'));
  const { body, text } = await call(dispatchDomain.handlers, 'dispatchGetDeliveryQueue', 'admin', 'admin-uid', {});
  // Guard against a vacuous pass: the order must actually be in the payload.
  expectEqual(body?.data?.orders?.length, 1, 'the order is present in the queue');
  expectEqual(text.includes(CODE), false, 'queue payload does not contain the code string');
  expectEqual(text.includes('deliveryCode'), false, 'queue payload has no deliveryCode key');
});

Deno.test('dispatchGetOrderDetail: no rider-facing field carries the code', async () => {
  installFake(buildOrder('preparing'));
  const { body, text } = await call(dispatchDomain.handlers, 'dispatchGetOrderDetail', 'admin', 'admin-uid', {
    orderId: 'order-1',
  });
  expectEqual(body?.data?.order?.id, 'order-1', 'the order is present in the detail');
  expectEqual(text.includes(CODE), false, 'detail payload does not contain the code string');
  expectEqual(text.includes('deliveryCode'), false, 'detail payload has no deliveryCode key');
});
