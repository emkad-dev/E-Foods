// Tests for grouped customer checkout across multiple restaurants.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const placeHandler = ordersDomain.handlers.placeCustomerOrder;
if (typeof placeHandler !== 'function') {
  throw new Error('ordersDomain.handlers.placeCustomerOrder is not registered.');
}

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const CUSTOMER_CONTEXT = {
  email: 'customer@example.test',
  role: 'customer',
  token: 'fake-token',
  uid: 'customer-uid',
  userProfile: { uid: 'customer-uid', email: 'customer@example.test', role: 'customer', accountDisabled: false },
};

type Row = Record<string, unknown>;

const restaurants: Record<string, Row> = {
  'restaurant-1': {
    id: 'restaurant-1',
    isOpen: true,
    isPublished: true,
    menu: [
      {
        category: 'Mains',
        items: [
          {
            id: 'item-1',
            isAvailable: true,
            name: 'Jollof Rice',
            price: 2000,
          },
        ],
      },
    ],
    minOrder: 0,
    name: 'Kitchen One',
    pausedUntil: null,
    supportsDelivery: true,
    supportsPickup: true,
  },
  'restaurant-2': {
    id: 'restaurant-2',
    isOpen: true,
    isPublished: true,
    menu: [
      {
        category: 'Sides',
        items: [
          {
            id: 'item-2',
            isAvailable: true,
            name: 'Plantain',
            price: 800,
          },
        ],
      },
    ],
    minOrder: 0,
    name: 'Kitchen Two',
    pausedUntil: null,
    supportsDelivery: true,
    supportsPickup: true,
  },
};

const installMocks = () => {
  const state = {
    groupInserts: [] as Row[],
    itemInserts: [] as unknown[],
    orderInserts: [] as Row[],
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'RestaurantRecord') {
      const builder: any = {
        select: () => builder,
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => ({ data: restaurants[value] ?? null, error: null }),
        }),
      };
      return builder;
    }

    if (table === 'RestaurantApproval' || table === 'PlatformSettings' || table === 'RestaurantHours') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            returns: async () => ({ data: [], error: null }),
          }),
        }),
      };
    }

    if (table === 'OrderGroup') {
      return {
        insert: async (payload: Row) => {
          state.groupInserts.push(payload);
          return { error: null };
        },
      };
    }

    if (table === 'CustomerOrder') {
      return {
        insert: async (payload: Row) => {
          state.orderInserts.push(payload);
          return { error: null };
        },
        // Placement also runs risk-signal lookups over the customer's recent
        // orders (riskSignals.ts -> loadRecentCustomerOrders), which reads this
        // same table. They only need a query-shaped empty response. This mirrors
        // the CustomerOrder mock in orderModifiers.test.ts, which grew the same
        // builder when risk signals landed; this file missed it because it was
        // registered in no test list and so never ran.
        select: () => {
          // deno-lint-ignore no-explicit-any
          const builder: any = {
            eq: () => builder,
            gte: () => builder,
            lt: () => builder,
            order: () => builder,
            limit: () => builder,
            returns: () => builder,
            maybeSingle: async () => ({ data: null, error: null }),
            single: async () => ({ data: null, error: null }),
            then: (resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (r: unknown) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(resolve, reject),
          };
          return builder;
        },
      };
    }

    if (table === 'OrderItem') {
      return {
        insert: async (payload: unknown) => {
          state.itemInserts.push(payload);
          return { error: null };
        },
      };
    }

    if (table === 'DeliveryEvent') {
      return { insert: async () => ({ error: null }) };
    }

    if (
      table === 'PromoCode' ||
      table === 'PromoRedemption' ||
      table === 'UserRole' ||
      table === 'UserAccount' ||
      table === 'IdempotencyRecord' ||
      table === 'PaymentTransaction'
    ) {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        returns: () => builder,
        upsert: async () => ({ error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    }

    throw new Error(`orderGroups.test.ts: unexpected table "${table}"`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response('{}', { status: 200 }))) as typeof fetch;

  return {
    state,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

const place = async (data: Row) =>
  // deno-lint-ignore no-explicit-any
  await (placeHandler as any)({ context: CUSTOMER_CONTEXT, data, request: fakeRequest() });

// SP-4: placeCustomerOrder is now a stub returning 410. The multi-restaurant
// group-order test is retained as a 410 assertion; the original assertions
// on group/order writes are removed (handler exits before any DB access).
Deno.test('placeCustomerOrder creates one group and one order per restaurant', async () => {
  const mocks = installMocks();
  try {
    let thrown: unknown = null;
    try {
      await place({
        fulfillmentType: 'delivery',
        idempotencyKey: 'group-test',
        items: [
          { id: 'item-1', quantity: 1, restaurantId: 'restaurant-1', restaurantName: 'Kitchen One' },
          { id: 'item-2', quantity: 2, restaurantId: 'restaurant-2', restaurantName: 'Kitchen Two' },
        ],
        paymentMethod: 'cash',
        restaurantId: 'restaurant-1',
        tipAmount: 0,
        deliveryLocation: {
          address: 'Test address',
          latitude: 6.52,
          longitude: 3.38,
        },
      });
    } catch (error) {
      thrown = error;
    }
    expectEqual((thrown as { status?: number })?.status, 410, 'stub returns 410');
  } finally {
    mocks.restore();
  }
});
