// Originally tested Task 16 (F2) item-availability enforcement in the REAL
// `placeCustomerOrder` handler. SP-4 (cash removal) stubbed the handler to
// return 410 immediately for all inputs, making the availability logic
// unreachable. Tests below are updated to reflect the new stub behavior.
// The drift guard is kept so catalog availability logic stays tested (the
// stub makes placement permanently disagree, so the drift-guard assertion
// is replaced with a stub-aware check).

import { hasAvailableMenuItem } from '../../public-catalog/catalog.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');
const originalPlaceOrderAvailabilityFrom = serviceClient.from.bind(serviceClient);
const originalPlaceOrderAvailabilityRpc = serviceClient.rpc.bind(serviceClient);
const originalPlaceOrderAvailabilityFetch = globalThis.fetch;

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const handler = ordersDomain.handlers.placeCustomerOrder;
if (typeof handler !== 'function') {
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

type MenuItemFixture = {
  id: string;
  name: string;
  price: number;
  isAvailable?: boolean;
  unavailableUntil?: string;
};

const buildMenu = (item: MenuItemFixture) => [{ category: 'Mains', items: [item] }];

const buildRestaurant = (overrides: Record<string, unknown> = {}) => ({
  id: 'restaurant-1',
  name: 'Test Kitchen',
  isPublished: true,
  isOpen: true,
  supportsDelivery: true,
  supportsPickup: true,
  minOrder: 0,
  deliveryFee: 0,
  pausedUntil: null,
  menu: buildMenu({ id: 'item-1', name: 'Jollof Rice', price: 2000, isAvailable: true }),
  ...overrides,
});

/**
 * Installs fresh `serviceClient.from(...)` and `fetch` fakes covering every
 * table this handler's success path touches: RestaurantRecord/
 * RestaurantApproval (loadRestaurantById), PlatformSettings
 * (loadPricingConfig, falls back to defaults on a null row), and
 * CustomerOrder/OrderItem/DeliveryEvent (order creation). notifyRestaurantUsers
 * and the confirmation email are wrapped in notifySafely upstream (swallows
 * errors), and RESEND_API_KEY is unset in this test env, so neither needs a
 * mock. An unhandled table throws loudly rather than silently returning
 * empty data.
 */
const installMocks = (restaurant: Record<string, unknown> | null) => {
  const state = {
    deliveryEvents: [] as unknown[],
    itemInserts: [] as unknown[],
    orderInserts: [] as unknown[],
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'RestaurantRecord') {
      return {
        select: (_columns: string) => ({
          eq: (_column: string, _value: string) => ({
            maybeSingle: async () => ({ data: restaurant, error: null }),
          }),
        }),
      };
    }

    if (table === 'RestaurantApproval') {
      return {
        select: (_columns: string) => ({
          eq: (_column: string, _value: string) => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }

    if (table === 'PlatformSettings') {
      return {
        select: (_columns: string) => ({
          eq: (_column: string, _value: string) => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }

    if (table === 'CustomerOrder') {
      return {
        insert: async (payload: unknown) => {
          state.orderInserts.push(payload);
          return { error: null };
        },
        select: () => {
          // Risk-signal reads during placement only need a query-shaped empty
          // response here.
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
            then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(resolve),
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
        insert: async (payload: unknown) => {
          state.deliveryEvents.push(payload);
          return { error: null };
        },
      };
    }

    // Task 17 (G1): placement now resolves promos. With no code supplied and no
    // automatic offers seeded, PromoCode reads empty and no discount applies —
    // these availability tests place orders without a code, so this is a no-op.
    if (table === 'PromoCode' || table === 'PromoRedemption') {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lt: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        returns: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    }

    throw new Error(`placeCustomerOrderAvailability.test.ts: unexpected table "${table}"`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/realtime/v1/api/broadcast')) {
      return new Response('{}', { status: 200 });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  return state;
};

const placeOrder = async (data: Record<string, unknown>) =>
  // deno-lint-ignore no-explicit-any
  await (handler as any)({ context: CUSTOMER_CONTEXT, data, request: fakeRequest() });

const BASE_ORDER_INPUT = {
  fulfillmentType: 'pickup',
  paymentMethod: 'cash',
  restaurantId: 'restaurant-1',
};

const futureIso = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastIso = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

Deno.test('placeCustomerOrder: rejects any input with 410 (handler is a stub since SP-4 cash removal)', async () => {
  const restaurant = buildRestaurant({
    menu: buildMenu({ id: 'item-1', name: 'Jollof Rice', price: 2000, isAvailable: false }),
  });
  installMocks(restaurant);

  let thrown: unknown = null;
  try {
    await placeOrder({ ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }] });
  } catch (error) {
    thrown = error;
  }

  expectEqual(thrown instanceof Error, true, 'handler should throw');
  expectEqual((thrown as { status?: number })?.status, 410, 'stub returns 410 for any input');
});

Deno.test('placeCustomerOrder: stub returns 410 regardless of item availability state', async () => {
  const restaurant = buildRestaurant({
    menu: buildMenu({ id: 'item-1', name: 'Jollof Rice', price: 2000, unavailableUntil: futureIso() }),
  });
  installMocks(restaurant);

  let thrown: unknown = null;
  try {
    await placeOrder({ ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }] });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: stub returns 410 even with a past unavailableUntil', async () => {
  const restaurant = buildRestaurant({
    menu: buildMenu({ id: 'item-1', name: 'Jollof Rice', price: 2000, unavailableUntil: pastIso() }),
  });
  installMocks(restaurant);

  let thrown: unknown = null;
  try {
    await placeOrder({ ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }] });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: stub returns 410 even for a paused store', async () => {
  const restaurant = buildRestaurant({ pausedUntil: futureIso() });
  installMocks(restaurant);

  let thrown: unknown = null;
  try {
    await placeOrder({ ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }] });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: stub returns 410 even with a past pausedUntil', async () => {
  const restaurant = buildRestaurant({ pausedUntil: pastIso() });
  installMocks(restaurant);

  let thrown: unknown = null;
  try {
    await placeOrder({ ...BASE_ORDER_INPUT, items: [] });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 410, 'stub returns 410');
});

// --- Drift guard -----------------------------------------------------------
//
// SP-4: placeCustomerOrder is now a stub returning 410 for all inputs, so
// the original "catalog and placement agree" assertion no longer applies.
// The catalog half of the guard is kept so hasAvailableMenuItem's behavior
// continues to be asserted directly; the placement half now just verifies
// the stub always returns 410 (not that it agrees with the catalog).
Deno.test('drift guard: hasAvailableMenuItem (catalog list filter) returns expected availability per item state', async () => {
  const cases: Array<{ expectAvailable: boolean; item: MenuItemFixture; label: string }> = [
    { expectAvailable: true, item: { id: 'item-1', name: 'Jollof Rice', price: 2000 }, label: 'available, no fields set' },
    {
      expectAvailable: false,
      item: { id: 'item-1', name: 'Jollof Rice', price: 2000, isAvailable: false },
      label: 'manual off (indefinite)',
    },
    {
      expectAvailable: false,
      item: { id: 'item-1', name: 'Jollof Rice', price: 2000, unavailableUntil: futureIso() },
      label: 'timed off, unavailableUntil in the FUTURE',
    },
    {
      expectAvailable: true,
      item: { id: 'item-1', name: 'Jollof Rice', price: 2000, unavailableUntil: pastIso() },
      label: 'timed off, unavailableUntil in the PAST (auto-resumed)',
    },
  ];

  for (const testCase of cases) {
    const menu = buildMenu(testCase.item);

    const catalogSaysAvailable = hasAvailableMenuItem(menu);
    expectEqual(
      catalogSaysAvailable,
      testCase.expectAvailable,
      `fixture sanity check for "${testCase.label}" (hasAvailableMenuItem)`
    );

    // Placement is now a stub: always 410 regardless of item state.
    const restaurant = buildRestaurant({ menu });
    installMocks(restaurant);

    let placementStatus: number | undefined;
    try {
      await placeOrder({ ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }] });
    } catch (error) {
      placementStatus = (error as { status?: number })?.status;
    }

    expectEqual(placementStatus, 410, `stub returns 410 for "${testCase.label}"`);
  }
});

Deno.test('placeCustomerOrderAvailability cleanup: restore shared client and fetch', () => {
  // Keep later files on the real client and fetch implementation.
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalPlaceOrderAvailabilityFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalPlaceOrderAvailabilityRpc;
  globalThis.fetch = originalPlaceOrderAvailabilityFetch;
});
