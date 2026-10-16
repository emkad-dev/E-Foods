// SP-1 Task 2: a rider holding only a PENDING offer must not receive the
// customer's address/phone/id/payment detail, either inside the offer snapshot
// (dispatchGetDeliveryQueue redacts it) or by opening the order detail
// (dispatchGetOrderDetail refuses a non-owner whose order is not in the manual
// queue - an order under a live offer never is).
//
// Calls the REAL handlers out of dispatchDomain.handlers. Env stubs must be set
// before the dynamic import (client.ts throws at module scope without them).
// Runs in package.json's second, --no-check `deno test` invocation because
// dispatch.ts carries pre-existing baseline type errors.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./domains/dispatch.ts');
const { serviceClient } = await import('./client.ts');

const expect = (cond: boolean, label: string) => {
  if (!cond) throw new Error(label);
};

const getQueue = dispatchDomain.handlers.dispatchGetDeliveryQueue;
const getDetail = dispatchDomain.handlers.dispatchGetOrderDetail;
if (typeof getQueue !== 'function' || typeof getDetail !== 'function') {
  throw new Error('dispatch handlers are not registered.');
}

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });
const ctx = (role: string, uid: string) => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

const ORDER = {
  id: 'order-1',
  customerId: 'cust-9',
  restaurantId: 'rest-1',
  restaurantName: 'Mama Put',
  status: 'ready_for_pickup',
  fulfillmentType: 'delivery',
  pricing: { total: 4300 },
  payment: { method: 'card', status: 'paid', reference: 'ref_x' },
  deliveryAddress: '15 Secret Lane',
  deliveryLocation: { latitude: 6.512345, longitude: 3.378912 },
  cancellation: null,
  timeline: null,
  needsAttention: false,
  scheduledFor: null,
  orderGroupId: null,
  createdAt: '2026-10-15T10:00:00Z',
  updatedAt: '2026-10-15T10:00:00Z',
};

// A live offer to rider-a on an order that has NO assignment row yet.
const OFFER = {
  id: 'offer-1',
  orderId: 'order-1',
  courierId: 'rider-a',
  status: 'pending',
  offeredAt: new Date().toISOString(),
  respondsBy: new Date(Date.now() + 45_000).toISOString(),
  respondedAt: null,
  sequence: 1,
};

const installMocks = () => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    let inCalled = false;
    const rowsFor = (): unknown[] => {
      switch (table) {
        case 'CustomerOrder':
          // The queue's first (eq fulfillmentType) read returns nothing so the
          // only order in play is the one reached through the pending offer.
          return inCalled ? [ORDER] : [];
        case 'DeliveryOffer':
          return [OFFER];
        case 'OrderItem':
        case 'DeliveryAssignment':
        case 'DeliveryEvent':
          return [];
        default:
          throw new Error(`dispatchOfferPrivacy.test.ts: unexpected table "${table}"`);
      }
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      neq: () => builder,
      limit: () => builder,
      in: () => {
        inCalled = true;
        return builder;
      },
      maybeSingle: async () => ({ data: table === 'CustomerOrder' ? ORDER : null, error: null }),
      // deno-lint-ignore no-explicit-any
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: rowsFor(), error: null }).then(resolve, reject),
    };
    return builder;
  };
};

Deno.test('pending offer snapshot in the queue is redacted server-side', async () => {
  installMocks();
  const res = await getQueue({ context: ctx('dispatch', 'rider-a'), data: {}, request: fakeRequest() } as never);
  const body = await res.json();
  const offers = body.data.offers as Array<{ order: Record<string, unknown> }>;
  expect(offers.length === 1, `expected 1 offer, got ${offers.length}`);
  const order = offers[0].order;
  expect(!('deliveryAddress' in order), 'address must be stripped from the offer');
  expect(!('customerId' in order), 'customerId must be stripped from the offer');
  expect(!('customerPhone' in order), 'phone must be stripped from the offer');
  expect(JSON.stringify(order.payment) === '{"status":"paid"}', 'payment must be reduced to status');
  expect((order.deliveryLocation as { latitude: number }).latitude === 6.512, 'location must be coarsened');
  expect(order.restaurantName === 'Mama Put', 'restaurant name must pass through');
  expect(!JSON.stringify(body).includes('Secret Lane'), 'address must appear nowhere in the payload');
});

Deno.test('dispatchGetOrderDetail refuses a rider who only holds a pending offer', async () => {
  installMocks();
  let status: unknown = null;
  try {
    await getDetail({
      context: ctx('dispatch', 'rider-a'),
      data: { orderId: 'order-1' },
      request: fakeRequest(),
    } as never);
  } catch (error) {
    status = (error as { status?: unknown }).status;
  }
  expect(status === 403, `expected a 403 refusal, got ${JSON.stringify(status)}`);
});
