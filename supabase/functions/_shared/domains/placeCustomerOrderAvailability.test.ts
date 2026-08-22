// Tests for Task 16 (F2)'s server-side enforcement inside the REAL
// `placeCustomerOrder` handler (out of `ordersDomain.handlers`, not a
// synthetic stub — same rationale and env-var setup as
// registry.real-domains.test.ts / adminSetRestaurantPublished.test.ts: the
// domain modules statically import `_shared/client.ts`, which throws at
// module-evaluation time without SUPABASE_URL / SERVICE_ROLE_KEY set first,
// so those two are set, then the domain module is dynamically imported.
//
// `catalog.ts` (public-catalog's card-list filter) has no such module-scope
// throw — `_shared/media.ts`'s own env reads default to '' rather than
// throwing — so it is imported statically up top, same as catalog.test.ts
// itself does.
//
// Mocks return snapshots (plain objects captured at call time), never live
// references the handler could mutate out from under an assertion.

import { hasAvailableMenuItem } from '../../public-catalog/catalog.ts';

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

Deno.test('placeCustomerOrder: rejects a manually-unavailable item, naming it, with 412', async () => {
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

  expectEqual(thrown instanceof Error, true, 'an unavailable item should throw');
  expectEqual((thrown as { status?: number })?.status, 412, 'unavailable item status');
  expectEqual(
    (thrown as Error).message.includes('Jollof Rice'),
    true,
    `rejection message should name the item, got: "${(thrown as Error).message}"`
  );
});

Deno.test('placeCustomerOrder: rejects an item timed-unavailable in the FUTURE, naming it, with 412', async () => {
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

  expectEqual((thrown as { status?: number })?.status, 412, 'future-timed-unavailable item status');
  expectEqual(
    (thrown as Error).message.includes('Jollof Rice'),
    true,
    `rejection message should name the item, got: "${(thrown as Error)?.message}"`
  );
});

Deno.test('placeCustomerOrder: accepts an item whose unavailableUntil is in the PAST (auto-resumed, no write needed)', async () => {
  const restaurant = buildRestaurant({
    menu: buildMenu({ id: 'item-1', name: 'Jollof Rice', price: 2000, unavailableUntil: pastIso() }),
  });
  const state = installMocks(restaurant);

  const response = await placeOrder({ ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }] });

  expectEqual(response.status, 200, 'a past unavailableUntil should not block the order');
  const body = await response.json();
  expectEqual(typeof body?.data?.orderId, 'string', 'response carries an orderId');
  expectEqual(state.orderInserts.length, 1, 'exactly one CustomerOrder insert');
});

Deno.test('placeCustomerOrder: rejects placement from a paused store with 412', async () => {
  const restaurant = buildRestaurant({ pausedUntil: futureIso() });
  installMocks(restaurant);

  let thrown: unknown = null;
  try {
    await placeOrder({ ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }] });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 412, 'paused store status');
  expectEqual(
    /paused/i.test((thrown as Error)?.message ?? ''),
    true,
    `rejection should mention the store is paused, got: "${(thrown as Error)?.message}"`
  );
});

Deno.test('placeCustomerOrder: a pausedUntil in the PAST does not block placement (auto-resumed, no write needed)', async () => {
  const restaurant = buildRestaurant({ pausedUntil: pastIso() });
  installMocks(restaurant);

  let thrown: unknown = null;
  try {
    // Empty items deliberately trips a DIFFERENT, later 400 ("Add at least
    // one item...") — proving the request got past the pause gate into
    // buildOrderItems instead of being rejected by the pause check. If the
    // pause check still fired here, this would be a 412 pause message, not a
    // 400 empty-items message.
    await placeOrder({ ...BASE_ORDER_INPUT, items: [] });
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 400, 'should fail on empty items, not the (expired) pause check');
  expectEqual(
    (thrown as Error)?.message,
    'Add at least one item before placing an order.',
    'failure must be the empty-items message, not a paused-store rejection'
  );
});

// --- Drift guard -----------------------------------------------------------
//
// Drives BOTH real call sites — public-catalog/catalog.ts's
// hasAvailableMenuItem (the card-list filter) and the real
// ordersDomain.handlers.placeCustomerOrder (the placement check) — with the
// IDENTICAL item fixture across every availability state, and asserts they
// always agree. This is the regression guard for the "ONE shared predicate"
// requirement: today both delegate to _shared/availability.ts's
// isMenuItemAvailable, so they agree by construction, but this test asserts
// the observable BEHAVIOR, not the import graph — if either file ever stops
// importing the shared predicate and hand-rolls its own check instead, this
// test starts failing the moment the two diverge, exactly the "hidden from
// the list but orderable at checkout" bug class Task 16's brief calls out.
Deno.test('drift guard: hasAvailableMenuItem (catalog list filter) and placeCustomerOrder (placement) agree on every item state', async () => {
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

    const restaurant = buildRestaurant({ menu });
    installMocks(restaurant);

    let placementAccepted = true;
    let rejectionMessage = '';
    try {
      await placeOrder({ ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }] });
    } catch (error) {
      placementAccepted = false;
      rejectionMessage = error instanceof Error ? error.message : String(error);
    }

    expectEqual(
      placementAccepted,
      catalogSaysAvailable,
      `placeCustomerOrder disagreed with hasAvailableMenuItem for "${testCase.label}" ` +
        `(catalog says available=${catalogSaysAvailable}, placement accepted=${placementAccepted}, rejection: "${rejectionMessage}")`
    );
  }
});
