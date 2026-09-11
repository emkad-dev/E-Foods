// Tests for menu item modifiers and selected-option pricing in the customer
// order placement path.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');
const { normalizeModifierGroups, resolveModifierSelections } = await import('../itemModifiers.ts');
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

// Same shape as buildRestaurant, except the add-on group leaves min/max
// unconfigured - the case a real menu editor produces for "pick any of these".
// `max: null` is what the JSON column holds; `min` is simply absent.
const buildRestaurantWithOpenModifierGroup = (): Row => ({
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
              id: 'extras',
              label: 'Extras',
              max: null,
              mode: 'multi',
              options: [
                { id: 'plantain', label: 'Plantain', priceDelta: 300 },
                { id: 'salad', label: 'Salad', priceDelta: 200 },
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

// ── Unconfigured modifier bounds (Number(null) === 0) ─────────────────────
// `Number(null)` is 0 and 0 is finite, so a Number()-based guard normalizes an
// ABSENT min/max to a configured 0. That skips the derived fallbacks in
// resolveModifierSelections and rejects every selection with
// "Select no more than 0 option(s) for ..." - a 412 that blocks checkout.

Deno.test('normalizeModifierGroups keeps an unconfigured min/max null rather than zero', () => {
  const [group] = normalizeModifierGroups([
    { id: 'extras', label: 'Extras', max: null, min: null, mode: 'multi', options: [{ id: 'a' }] },
  ]);
  expectEqual(group.max, null, 'null max stays null');
  expectEqual(group.min, null, 'null min stays null');

  const [absent] = normalizeModifierGroups([{ id: 'extras', mode: 'multi', options: [{ id: 'a' }] }]);
  expectEqual(absent.max, null, 'absent max is null');
  expectEqual(absent.min, null, 'absent min is null');

  const [blank] = normalizeModifierGroups([
    { id: 'extras', max: '', min: false, mode: 'multi', options: [{ id: 'a' }] },
  ]);
  expectEqual(blank.max, null, 'empty-string max is null');
  expectEqual(blank.min, null, 'boolean min is null');

  // A deliberately-configured bound of 0 is still a real bound.
  const [zeroed] = normalizeModifierGroups([
    { id: 'extras', max: 0, min: 0, mode: 'multi', options: [{ id: 'a' }] },
  ]);
  expectEqual(zeroed.max, 0, 'explicit zero max is preserved');
  expectEqual(zeroed.min, 0, 'explicit zero min is preserved');
});

Deno.test('resolveModifierSelections derives a bound when max is unconfigured', () => {
  const multi = resolveModifierSelections({
    groups: [
      {
        id: 'extras',
        label: 'Extras',
        max: null,
        min: null,
        mode: 'multi',
        options: [
          { id: 'plantain', priceDelta: 300 },
          { id: 'salad', priceDelta: 200 },
          { id: 'egg', priceDelta: 150 },
        ],
      },
    ],
    selectedOptions: [
      { groupId: 'extras', optionId: 'plantain' },
      { groupId: 'extras', optionId: 'salad' },
    ],
  });
  expectEqual(multi.ok, true, `multi group with null max accepts selections (${JSON.stringify(multi)})`);
  expectEqual(multi.ok === true ? multi.optionDelta : null, 500, 'option deltas sum');

  const single = resolveModifierSelections({
    groups: [
      { id: 'protein', label: 'Protein', mode: 'single', required: true, options: [{ id: 'beef', priceDelta: 500 }] },
    ],
    selectedOptions: [{ groupId: 'protein', optionId: 'beef' }],
  });
  expectEqual(single.ok, true, `single-mode group with absent max accepts one selection (${JSON.stringify(single)})`);

  // The derived bound must not become a free pass: a real max still binds.
  const overMax = resolveModifierSelections({
    groups: [
      {
        id: 'extras',
        label: 'Extras',
        max: 1,
        mode: 'multi',
        options: [{ id: 'plantain', priceDelta: 300 }, { id: 'salad', priceDelta: 200 }],
      },
    ],
    selectedOptions: [
      { groupId: 'extras', optionId: 'plantain' },
      { groupId: 'extras', optionId: 'salad' },
    ],
  });
  expectEqual(overMax.ok, false, 'an explicit max of 1 still rejects two selections');

  // Single-mode is still capped at one even though max was never configured.
  const overSingle = resolveModifierSelections({
    groups: [
      {
        id: 'protein',
        label: 'Protein',
        mode: 'single',
        options: [{ id: 'beef', priceDelta: 500 }, { id: 'chicken', priceDelta: 300 }],
      },
    ],
    selectedOptions: [
      { groupId: 'protein', optionId: 'beef' },
      { groupId: 'protein', optionId: 'chicken' },
    ],
  });
  expectEqual(overSingle.ok, false, 'single-mode still rejects a second selection');
});

Deno.test('placeCustomerOrder accepts add-ons from a group with no configured max', async () => {
  const mocks = installMocks(buildRestaurantWithOpenModifierGroup());
  try {
    const response = await place({
      fulfillmentType: 'pickup',
      idempotencyKey: 'modifier-null-max-test',
      items: [
        {
          id: 'item-1',
          quantity: 1,
          selectedOptions: [
            { groupId: 'extras', optionId: 'plantain' },
            { groupId: 'extras', optionId: 'salad' },
          ],
        },
      ],
      paymentMethod: 'cash',
      restaurantId: 'restaurant-1',
      tipAmount: 0,
    });

    const body = await response.json();
    expectEqual(response.status, 200, `checkout is not blocked by a null max (${JSON.stringify(body)})`);
    expectEqual(body.data.status, 'placed', 'order lands immediately');
    // (2000 base + 300 + 200) × 1.2 + 100 = 3100
    expectEqual(body.data.total, 3100, 'option-inclusive price is marked up');
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
