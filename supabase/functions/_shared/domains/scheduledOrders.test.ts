// Tests for scheduled orders inside the REAL customer order handlers
// (placeCustomerOrder / cancelCustomerOrder, out of ordersDomain.handlers) —
// same env-bootstrap and dynamic-import discipline as
// placeCustomerOrderAvailability.test.ts. Runs in the SECOND, --no-check
// `deno test` invocation (domains/orders.ts carries baselined type errors).
//
// Mocks return snapshots (plain objects captured at call time); asserts the
// STORED rows and values, never "a function was called" (except where the point
// IS that a specific RPC fired — the promo release on cancel).
//
// Coverage:
//   * a valid slot lands the order in 'scheduled' with scheduledFor + a timeline
//     carrying scheduledAt/scheduledFor and NO placedAt (the clock is stamped at
//     release, not here);
//   * an invalid slot (closed day) is a 412 and writes nothing;
//   * an IMMEDIATE order (no scheduledFor) is byte-for-byte unregressed:
//     'placed', timeline.placedAt set, scheduledFor null;
//   * cancelling a scheduled order before release refunds in FULL and releases
//     the promo redemption (ebuy_release_promo_redemption fired).

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');
const { WAT_OFFSET_MS } = await import('../scheduledOrders.ts');
const originalScheduledOrdersFrom = serviceClient.from.bind(serviceClient);
const originalScheduledOrdersRpc = serviceClient.rpc.bind(serviceClient);
const originalScheduledOrdersFetch = globalThis.fetch;

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const placeHandler = ordersDomain.handlers.placeCustomerOrder;
const cancelHandler = ordersDomain.handlers.cancelCustomerOrder;
if (typeof placeHandler !== 'function') {
  throw new Error('ordersDomain.handlers.placeCustomerOrder is not registered.');
}
if (typeof cancelHandler !== 'function') {
  throw new Error('ordersDomain.handlers.cancelCustomerOrder is not registered.');
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

const localParts = (ms: number) => {
  const shifted = new Date(ms + WAT_OFFSET_MS);
  return { day: shifted.getUTCDay(), minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
};

/** Seven all-open rows (00:00–23:59) unless `closedDay` is given. */
const buildHoursRows = (closedDay?: number): Row[] => {
  const rows: Row[] = [];
  for (let day = 0; day < 7; day += 1) {
    rows.push({
      dayOfWeek: day,
      isClosed: closedDay === day,
      opensAt: '00:00',
      closesAt: '23:59',
    });
  }
  return rows;
};

const buildRestaurant = (overrides: Row = {}): Row => ({
  id: 'restaurant-1',
  name: 'Test Kitchen',
  isPublished: true,
  isOpen: true,
  supportsDelivery: true,
  supportsPickup: true,
  minOrder: 0,
  deliveryFee: 0,
  pausedUntil: null,
  menu: [{ category: 'Mains', items: [{ id: 'item-1', name: 'Jollof Rice', price: 2000, isAvailable: true }] }],
  ...overrides,
});

// ── placement mock ─────────────────────────────────────────────────────────
const installPlacementMocks = (restaurant: Row, hoursRows: Row[]) => {
  const state = {
    orderInserts: [] as Row[],
    itemInserts: [] as unknown[],
    deliveryEvents: [] as unknown[],
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'RestaurantRecord') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: restaurant, error: null }) }) }),
      };
    }
    if (table === 'RestaurantApproval') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    }
    if (table === 'PlatformSettings') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    }
    if (table === 'RestaurantHours') {
      return { select: () => ({ eq: () => ({ returns: async () => ({ data: hoursRows, error: null }) }) }) };
    }
    if (table === 'CustomerOrder') {
      return {
        insert: async (payload: Row) => {
          state.orderInserts.push(payload);
          return { error: null };
        },
        select: () => {
          // Risk-signal reads during placement only need a query-shaped empty
          // response here.
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
    if (
      table === 'PromoCode' ||
      table === 'PromoRedemption' ||
      // Notification recipient reads — notifySafely swallows anything here, but
      // an empty builder keeps the test output clean.
      table === 'UserRole' ||
      table === 'UserAccount'
    ) {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lt: () => builder,
        in: () => builder,
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
    throw new Error(`scheduledOrders.test.ts (placement): unexpected table "${table}"`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response('{}', { status: 200 }))) as typeof fetch;

  return { state, restore: () => { globalThis.fetch = originalFetch; } };
};

const place = async (data: Row) =>
  // deno-lint-ignore no-explicit-any
  await (placeHandler as any)({ context: CUSTOMER_CONTEXT, data, request: fakeRequest() });

const BASE_INPUT: Row = { fulfillmentType: 'pickup', paymentMethod: 'cash', restaurantId: 'restaurant-1' };

// A valid slot: 2 days ahead, all-open hours.
const validSlotIso = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

Deno.test('placeCustomerOrder: a valid slot lands the order in scheduled with scheduledFor and no placedAt', async () => {
  const mocks = installPlacementMocks(buildRestaurant(), buildHoursRows());
  try {
    const slot = validSlotIso();
    const response = await place({ ...BASE_INPUT, items: [{ id: 'item-1', quantity: 1 }], scheduledFor: slot });
    const body = await response.json();
    expectEqual(body.data.status, 'scheduled', 'response status is scheduled');
    expectEqual(body.data.scheduledFor, slot, 'response echoes the slot');

    expectEqual(mocks.state.orderInserts.length, 1, 'exactly one order insert');
    const inserted = mocks.state.orderInserts[0];
    expectEqual(inserted.status, 'scheduled', 'stored status is scheduled');
    expectEqual(inserted.scheduledFor, slot, 'stored scheduledFor');
    const timeline = inserted.timeline as Row;
    expectEqual(timeline.scheduledFor, slot, 'timeline carries scheduledFor');
    expectEqual(typeof timeline.scheduledAt, 'string', 'timeline carries scheduledAt');
    expectEqual('placedAt' in timeline, false, 'timeline has NO placedAt (clock starts at release)');
  } finally {
    mocks.restore();
  }
});

Deno.test('placeCustomerOrder: a slot on a closed day is rejected 412 and writes nothing', async () => {
  const slot = validSlotIso();
  const { day } = localParts(Date.parse(slot));
  const mocks = installPlacementMocks(buildRestaurant(), buildHoursRows(day));
  try {
    let thrown: unknown = null;
    try {
      await place({ ...BASE_INPUT, items: [{ id: 'item-1', quantity: 1 }], scheduledFor: slot });
    } catch (error) {
      thrown = error;
    }
    expectEqual((thrown as { status?: number })?.status, 412, 'closed-day slot is a 412');
    expectEqual(mocks.state.orderInserts.length, 0, 'no order was written');
  } finally {
    mocks.restore();
  }
});

Deno.test('placeCustomerOrder: an immediate order (no scheduledFor) is unregressed — placed with placedAt', async () => {
  const mocks = installPlacementMocks(buildRestaurant(), buildHoursRows());
  try {
    const response = await place({ ...BASE_INPUT, items: [{ id: 'item-1', quantity: 1 }] });
    const body = await response.json();
    expectEqual(body.data.status, 'placed', 'immediate order lands placed');
    expectEqual(body.data.scheduledFor, null, 'no scheduledFor on the response');

    const inserted = mocks.state.orderInserts[0];
    expectEqual(inserted.status, 'placed', 'stored status is placed');
    expectEqual(inserted.scheduledFor, null, 'stored scheduledFor is null');
    const timeline = inserted.timeline as Row;
    expectEqual(typeof timeline.placedAt, 'string', 'timeline.placedAt is stamped at creation');
    expectEqual('scheduledFor' in timeline, false, 'no scheduledFor in an immediate timeline');
  } finally {
    mocks.restore();
  }
});

// ── cancel-before-release mock ───────────────────────────────────────────────
const installCancelMocks = (order: Row) => {
  const orders: Row[] = [{ ...order }];
  const deliveryEvents: Row[] = [];
  const rpcCalls: Array<{ fn: string; params: Row }> = [];
  const snapshot = (row: Row) => ({ ...row });

  const selectBuilder = (rows: Row[]) => {
    let filtered = [...rows];
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      eq(col: string, val: unknown) {
        filtered = filtered.filter((row) => row[col] === val);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((row) => vals.includes(row[col]));
        return builder;
      },
      gte(col: string, val: unknown) {
        filtered = filtered.filter((row) => {
          const cell = row[col];
          if (cell === null || cell === undefined) return false;
          return (cell as string | number) >= (val as string | number);
        });
        return builder;
      },
      lt(col: string, val: unknown) {
        filtered = filtered.filter((row) => {
          const cell = row[col];
          if (cell === null || cell === undefined) return false;
          return (cell as string | number) < (val as string | number);
        });
        return builder;
      },
      order() {
        return builder;
      },
      returns() {
        return Promise.resolve({ data: filtered.map(snapshot), error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: filtered[0] ? snapshot(filtered[0]) : null, error: null });
      },
      single() {
        return Promise.resolve({ data: filtered[0] ? snapshot(filtered[0]) : null, error: null });
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (r: unknown) => unknown) {
        return Promise.resolve({ data: filtered.map(snapshot), error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  const updateBuilder = (rows: Row[]) => (payload: Row) => {
    const filters: Array<[string, unknown]> = [];
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return builder;
      },
      then(resolve: (v: { error: null }) => unknown, reject?: (r: unknown) => unknown) {
        for (const row of rows) {
          if (filters.every(([col, val]) => row[col] === val)) {
            Object.assign(row, payload);
          }
        }
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'CustomerOrder') {
      return { select: () => selectBuilder(orders), update: updateBuilder(orders) };
    }
    if (table === 'OrderItem' || table === 'DeliveryAssignment') {
      return { select: () => selectBuilder([]) };
    }
    if (table === 'DeliveryEvent') {
      return {
        select: () => selectBuilder(deliveryEvents),
        insert: async (payload: Row) => {
          deliveryEvents.push({ ...payload });
          return { error: null };
        },
      };
    }
    // Notification recipient reads — notifySafely swallows anything here anyway.
    if (table === 'UserRole' || table === 'UserAccount' || table === 'RestaurantRecord') {
      return { select: () => selectBuilder([]) };
    }
    throw new Error(`scheduledOrders.test.ts (cancel): unexpected table "${table}"`);
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = (fn: string, params: Row) => {
    rpcCalls.push({ fn, params });
    if (fn === 'ebuy_release_dispatch_assignment_load') {
      return Promise.resolve({ data: [{ released: false }], error: null });
    }
    if (fn === 'ebuy_release_promo_redemption') {
      return Promise.resolve({ data: null, error: null });
    }
    throw new Error(`scheduledOrders.test.ts (cancel): unexpected rpc "${fn}"`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response('{}', { status: 200 }))) as typeof fetch;

  return { orders, rpcCalls, restore: () => { globalThis.fetch = originalFetch; } };
};

Deno.test('cancelCustomerOrder: a scheduled order cancelled before release is fully refunded and frees its promo slot', async () => {
  const CAPTURED = 5000;
  const mocks = installCancelMocks({
    id: 'order-sched',
    customerId: 'customer-uid',
    restaurantId: 'restaurant-1',
    restaurantName: 'Test Kitchen',
    status: 'scheduled',
    fulfillmentType: 'pickup',
    payment: { method: 'card', status: 'paid', capturedAmount: CAPTURED },
    pricing: { total: CAPTURED },
    scheduledFor: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    timeline: { scheduledAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  try {
    const response = await // deno-lint-ignore no-explicit-any
      (cancelHandler as any)({ context: CUSTOMER_CONTEXT, data: { orderId: 'order-sched' }, request: fakeRequest() });
    const body = await response.json();
    expectEqual(body.data.status, 'cancelled', 'cancel response status');
    expectEqual(body.data.refundRate, 1, 'full refund rate returned');

    const stored = mocks.orders[0];
    expectEqual(stored.status, 'cancelled', 'stored status is cancelled');
    const payment = stored.payment as Row;
    expectEqual(payment.refundAmount, CAPTURED, 'refund equals the captured amount (full)');
    expectEqual(payment.status, 'refunded', 'payment marked refunded');

    expectEqual(
      mocks.rpcCalls.some((call) => call.fn === 'ebuy_release_promo_redemption' && call.params.p_order_id === 'order-sched'),
      true,
      'the promo redemption was released for this order',
    );
  } finally {
    mocks.restore();
  }
});

Deno.test('scheduledOrders cleanup: restore shared client and fetch', () => {
  // Keep later files on the real client and fetch implementation.
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalScheduledOrdersFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalScheduledOrdersRpc;
  globalThis.fetch = originalScheduledOrdersFetch;
});
