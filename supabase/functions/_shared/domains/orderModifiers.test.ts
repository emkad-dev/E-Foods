// Tests for menu item modifiers and selected-option pricing in the customer
// order placement path.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');
const originalOrderModifiersFrom = serviceClient.from.bind(serviceClient);
const originalOrderModifiersRpc = serviceClient.rpc.bind(serviceClient);
const originalOrderModifiersFetch = globalThis.fetch;

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

const buildRestaurant = (): Row => ({
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
          modifierGroups: [
            {
              id: 'protein',
              label: 'Protein',
              mode: 'single',
              required: true,
              min: 1,
              max: 1,
              options: [
                { id: 'chicken', label: 'Chicken', priceDelta: 300 },
                { id: 'beef', label: 'Beef', priceDelta: 500 },
              ],
            },
          ],
          name: 'Jollof Rice',
          price: 2000,
        },
      ],
    },
  ],
  minOrder: 0,
  name: 'Test Kitchen',
  pausedUntil: null,
  supportsDelivery: true,
  supportsPickup: true,
});

const installMocks = (restaurant: Row) => {
  const state = {
    itemInserts: [] as unknown[],
    orderInserts: [] as Row[],
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'RestaurantRecord') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: restaurant, error: null }) }) }),
      };
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

    if (table === 'CustomerOrder') {
      return {
        insert: async (payload: Row) => {
          state.orderInserts.push(payload);
          return { error: null };
        },
        select: () => {
          // Risk-signal lookups on recent customer orders can run during
          // placement; they only need a query-shaped empty response here.
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
      return {
        insert: async () => ({ error: null }),
      };
    }

    if (
      table === 'PromoCode' ||
      table === 'PromoRedemption' ||
      table === 'UserRole' ||
      table === 'UserAccount' ||
      table === 'IdempotencyRecord'
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

    throw new Error(`orderModifiers.test.ts: unexpected table "${table}"`);
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

Deno.test('placeCustomerOrder prices modifier selections and persists the selection payload', async () => {
  const mocks = installMocks(buildRestaurant());
  try {
    const response = await place({
      fulfillmentType: 'pickup',
      idempotencyKey: 'modifier-test',
      items: [
        {
          id: 'item-1',
          quantity: 1,
          selectedOptions: [{ groupId: 'protein', optionId: 'chicken' }],
        },
      ],
      paymentMethod: 'cash',
      restaurantId: 'restaurant-1',
      tipAmount: 0,
    });

    const body = await response.json();
    expectEqual(body.data.status, 'placed', 'order lands immediately');
    expectEqual(body.data.total, 2860, 'option-inclusive price is marked up');
    expectEqual(mocks.state.orderInserts.length, 1, 'one order is written');
    expectEqual(mocks.state.itemInserts.length, 1, 'one item payload is written');

    const insertedItem = (mocks.state.itemInserts[0] as Row[])[0] ?? {};
    expectEqual(insertedItem.price, 2860, 'stored item carries the option-inclusive customer price');
    expectEqual(
      JSON.stringify(insertedItem.selectedOptions),
      JSON.stringify([
        {
          groupId: 'protein',
          groupLabel: 'Protein',
          optionId: 'chicken',
          optionLabel: 'Chicken',
          priceDelta: 300,
        },
      ]),
      'stored item carries the selected option payload'
    );
  } finally {
    mocks.restore();
  }
});

Deno.test('orderModifiers cleanup: restore shared client and fetch', () => {
  // Keep later files on the real client and fetch implementation.
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalOrderModifiersFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalOrderModifiersRpc;
  globalThis.fetch = originalOrderModifiersFetch;
});
