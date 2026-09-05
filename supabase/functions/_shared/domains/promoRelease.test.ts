// Task 17 (G1) review fix: a promo redemption must be RELEASED (its cap slot
// freed) whenever the order it was tied to ends cancelled/refunded — not only
// on the two synchronous placement/init failure paths, but on all three
// POST-placement terminal-cancel transitions:
//   1. cancelCustomerOrder            (customer/admin self-cancel + refund)
//   2. maybeExpireUnpaidOrder         (unpaid-payment timeout auto-cancel)
//   3. sweepUnacceptedOrders          (acceptance-deadline auto-cancel + full refund)
//
// All three funnel through the ONE shared `releasePromoRedemption` in
// _shared/orders.ts, which calls ebuy_release_promo_redemption (delete by the
// UNIQUE orderId). These tests drive the REAL entry points out of their real
// modules and assert the PromoRedemption store, plus the idempotency/no-op
// properties (no-promo order, double-release: no negative count, no double-free).
//
// Runs in package.json's second, --no-check `deno test` invocation.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const originalPromoReleaseFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;

const { ordersDomain } = await import('./orders.ts');
const sharedOrders = await import('../orders.ts');
const { sweepUnacceptedOrders } = await import('../acceptanceDeadlineSweep.ts');
const { serviceClient } = await import('../client.ts');
const originalPromoReleaseFrom = serviceClient.from.bind(serviceClient);
const originalPromoReleaseRpc = serviceClient.rpc.bind(serviceClient);

const cancelCustomerOrder = ordersDomain.handlers.cancelCustomerOrder;
if (typeof cancelCustomerOrder !== 'function') {
  throw new Error('ordersDomain.handlers.cancelCustomerOrder is not registered.');
}
const { maybeExpireUnpaidOrder, releasePromoRedemption } = sharedOrders;
if (typeof maybeExpireUnpaidOrder !== 'function' || typeof releasePromoRedemption !== 'function') {
  throw new Error('maybeExpireUnpaidOrder / releasePromoRedemption are not exported from _shared/orders.ts.');
}
if (typeof sweepUnacceptedOrders !== 'function') {
  throw new Error('sweepUnacceptedOrders is not exported from acceptanceDeadlineSweep.ts.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });
type Row = Record<string, unknown>;
const snapshot = (row: Row) => ({ ...row });

// Generic postgrest-shaped in-memory table (select/insert/update/delete + the
// filter subset these paths use).
const createTable = (initialRows: Row[]) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));
  const q = () => {
    let filtered = [...rows];
    // deno-lint-ignore no-explicit-any
    const b: any = {
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] === val);
        return b;
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((r) => vals.includes(r[col]));
        return b;
      },
      gte(col: string, val: unknown) {
        filtered = filtered.filter((row) => {
          const cell = row[col];
          if (cell === null || cell === undefined) return false;
          return (cell as string | number) >= (val as string | number);
        });
        return b;
      },
      lt(col: string, val: unknown) {
        filtered = filtered.filter((row) => {
          const cell = row[col];
          if (cell === null || cell === undefined) return false;
          return (cell as string | number) < (val as string | number);
        });
        return b;
      },
      or() {
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      returns() {
        return b;
      },
      async maybeSingle() {
        return { data: filtered[0] ? snapshot(filtered[0]) : null, error: null };
      },
      async single() {
        return { data: filtered[0] ? snapshot(filtered[0]) : null, error: null };
      },
      select() {
        return b;
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (r: unknown) => unknown) {
        return Promise.resolve({ data: filtered.map(snapshot), error: null }).then(resolve, reject);
      },
    };
    return b;
  };
  return {
    rows,
    select() {
      return q();
    },
    async insert(payload: Row | Row[]) {
      for (const r of Array.isArray(payload) ? payload : [payload]) {
        rows.push({ ...r });
      }
      return { error: null };
    },
    update(updates: Row) {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        matches: [] as Row[],
        eq(col: string, val: unknown) {
          this.matches = rows.filter((r) => r[col] === val);
          for (const r of this.matches) {
            Object.assign(r, updates);
          }
          return b;
        },
        select() {
          return b;
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (r: unknown) => unknown) {
          return Promise.resolve({ data: (b.matches as Row[]).map(snapshot), error: null }).then(resolve, reject);
        },
      };
      return b;
    },
    delete() {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        eq(col: string, val: unknown) {
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i][col] === val) {
              rows.splice(i, 1);
            }
          }
          return b;
        },
        then(resolve: (v: { error: null }) => unknown, reject?: (r: unknown) => unknown) {
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  };
};

type Options = { orders?: Row[]; redemptions?: Row[] };

const installMocks = (options: Options = {}) => {
  const tables: Record<string, ReturnType<typeof createTable>> = {
    CustomerOrder: createTable(options.orders ?? []),
    OrderItem: createTable([]),
    DeliveryAssignment: createTable([]),
    DeliveryEvent: createTable([]),
    PromoRedemption: createTable(options.redemptions ?? []),
  };
  const tableFor = (name: string) => {
    if (!tables[name]) {
      tables[name] = createTable([]);
    }
    return tables[name];
  };

  let releaseCalls = 0;

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (name: string) => tableFor(name);
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    if (fn === 'ebuy_release_promo_redemption') {
      releaseCalls += 1;
      const orderId = params.p_order_id as string;
      const store = tables.PromoRedemption.rows;
      const idx = store.findIndex((r) => r.orderId === orderId);
      if (idx === -1) {
        return { data: [{ released: false, promoCodeId: null }], error: null };
      }
      const [removed] = store.splice(idx, 1);
      return { data: [{ released: true, promoCodeId: removed.promoCodeId }], error: null };
    }
    if (fn === 'ebuy_auto_cancel_unaccepted_order') {
      // The sweep's CAS: report a genuine cancel so the release path fires.
      return { data: [{ cancelled: true }], error: null };
    }
    // Everything else (dispatch load release, missed-count bumps, …) benign.
    return { data: [], error: null };
  };

  return {
    tables,
    redemptions: () => tables.PromoRedemption.rows,
    releaseCalls: () => releaseCalls,
  };
};

const customerContext = (uid: string) => ({
  email: `${uid}@example.test`,
  role: 'customer',
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role: 'customer', accountDisabled: false },
});

const cashOrder = (overrides: Row = {}): Row => ({
  id: 'order-1',
  customerId: 'user-1',
  restaurantId: 'rest-1',
  status: 'placed',
  fulfillmentType: 'pickup',
  payment: { method: 'cash', status: 'pending' },
  pricing: { total: 5000 },
  createdAt: new Date().toISOString(),
  ...overrides,
});

const redemption = (orderId = 'order-1'): Row => ({
  id: `redemption-${orderId}`,
  promoCodeId: 'promo-1',
  userId: 'user-1',
  orderId,
  discountAmount: 500,
  redeemedAt: new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// SHARED HELPER — idempotency / no-op / double-free safety.
// ---------------------------------------------------------------------------

Deno.test('releasePromoRedemption: releasing an order with a redemption frees exactly that row', async () => {
  const state = installMocks({ redemptions: [redemption('order-1'), redemption('order-2')] });
  await releasePromoRedemption('order-1');
  expectEqual(state.redemptions().length, 1, 'one row removed');
  expectEqual(state.redemptions()[0].orderId, 'order-2', 'the untargeted redemption is untouched');
});

Deno.test('releasePromoRedemption: releasing an order that never redeemed is a clean no-op', async () => {
  const state = installMocks({ redemptions: [redemption('order-2')] });
  await releasePromoRedemption('order-1'); // no redemption for order-1
  expectEqual(state.redemptions().length, 1, 'nothing removed, nothing thrown');
});

Deno.test('releasePromoRedemption: double-release is a no-op (no negative count, no double-free)', async () => {
  const state = installMocks({ redemptions: [redemption('order-1')] });
  await releasePromoRedemption('order-1');
  await releasePromoRedemption('order-1'); // already gone
  expectEqual(state.redemptions().length, 0, 'still zero — the second release removed nothing');
  expectEqual(state.releaseCalls(), 2, 'both releases ran without error');
});

// ---------------------------------------------------------------------------
// PATH 1 — cancelCustomerOrder (customer/admin self-cancel).
// ---------------------------------------------------------------------------

Deno.test('cancelCustomerOrder: cancelling a redeemed order releases its redemption (cap slot freed)', async () => {
  const state = installMocks({ orders: [cashOrder()], redemptions: [redemption('order-1')] });
  const response = await cancelCustomerOrder({ context: customerContext('user-1'), data: { orderId: 'order-1' }, request: fakeRequest() });
  expectEqual(response.status, 200, 'cancel succeeded');
  expectEqual(state.redemptions().length, 0, 'the redemption was released');
});

Deno.test('cancelCustomerOrder: cancelling a NO-PROMO order is a clean no-op (nothing to release)', async () => {
  const state = installMocks({ orders: [cashOrder()], redemptions: [] });
  const response = await cancelCustomerOrder({ context: customerContext('user-1'), data: { orderId: 'order-1' }, request: fakeRequest() });
  expectEqual(response.status, 200, 'cancel succeeded');
  expectEqual(state.redemptions().length, 0, 'store still empty, no error');
});

// ---------------------------------------------------------------------------
// PATH 2 — maybeExpireUnpaidOrder (payment timeout).
// ---------------------------------------------------------------------------

const timedOutCardOrder = (overrides: Row = {}): Row =>
  cashOrder({
    payment: { method: 'card', status: 'pending' },
    // Well past ORDER_PAYMENT_TIMEOUT_MS.
    createdAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  });

Deno.test('maybeExpireUnpaidOrder: a timed-out prepaid order releases its redemption on auto-cancel', async () => {
  const state = installMocks({ orders: [timedOutCardOrder()], redemptions: [redemption('order-1')] });
  const result = await maybeExpireUnpaidOrder(timedOutCardOrder() as never);
  expectEqual((result as { status?: string }).status, 'cancelled', 'the order expired to cancelled');
  expectEqual(state.redemptions().length, 0, 'the redemption was released');
});

Deno.test('maybeExpireUnpaidOrder: a timed-out NO-PROMO order is a clean no-op', async () => {
  const state = installMocks({ orders: [timedOutCardOrder()], redemptions: [] });
  await maybeExpireUnpaidOrder(timedOutCardOrder() as never);
  expectEqual(state.redemptions().length, 0, 'store still empty, no error');
});

Deno.test('maybeExpireUnpaidOrder: a still-fresh unpaid order does NOT cancel and does NOT release', async () => {
  const fresh = timedOutCardOrder({ createdAt: new Date().toISOString() });
  const state = installMocks({ orders: [fresh], redemptions: [redemption('order-1')] });
  const result = await maybeExpireUnpaidOrder(fresh as never);
  expectEqual((result as { status?: string }).status, 'placed', 'still placed');
  expectEqual(state.redemptions().length, 1, 'redemption kept — the order is still live');
});

// ---------------------------------------------------------------------------
// PATH 3 — sweepUnacceptedOrders (acceptance-deadline auto-cancel + full refund).
// ---------------------------------------------------------------------------

Deno.test('sweepUnacceptedOrders: an auto-cancelled order releases its redemption', async () => {
  const placed = cashOrder({
    payment: { method: 'card', status: 'paid', capturedAmount: 5000 },
    createdAt: '2020-01-01T00:00:00.000Z', // far past 2× any deadline
    // Both order-creation paths stamp timeline.placedAt; the sweep clocks off it.
    timeline: { placedAt: '2020-01-01T00:00:00.000Z' },
  });
  const state = installMocks({ orders: [placed], redemptions: [redemption('order-1')] });
  const result = await sweepUnacceptedOrders();
  expectEqual(result.cancelled, 1, 'the order was auto-cancelled');
  expectEqual(state.redemptions().length, 0, 'the redemption was released');
});

Deno.test('sweepUnacceptedOrders: an auto-cancelled NO-PROMO order is a clean no-op', async () => {
  const placed = cashOrder({
    payment: { method: 'card', status: 'paid', capturedAmount: 5000 },
    createdAt: '2020-01-01T00:00:00.000Z',
    timeline: { placedAt: '2020-01-01T00:00:00.000Z' },
  });
  const state = installMocks({ orders: [placed], redemptions: [] });
  const result = await sweepUnacceptedOrders();
  expectEqual(result.cancelled, 1, 'the order was auto-cancelled');
  expectEqual(state.redemptions().length, 0, 'store still empty, no error');
});

Deno.test('promoRelease cleanup: restore shared client and fetch', () => {
  // Keep later files on the real client and fetch implementation.
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalPromoReleaseFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalPromoReleaseRpc;
  globalThis.fetch = originalPromoReleaseFetch;
});
