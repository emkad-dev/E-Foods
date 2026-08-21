// Tests for the acceptance-deadline sweep (Task 14 / E3). They drive the REAL
// sweep - sweepUnacceptedOrders out of _shared/acceptanceDeadlineSweep.ts -
// against an in-memory postgrest/rpc mock, and assert the STORED rows and
// values (order status, the refund amount written into the payment ledger,
// needsAttention, RestaurantRecord.missedOrderCount, the DeliveryEvent rows),
// never merely "a function was called".
//
// The module statically imports _shared/client.ts, which throws at module
// scope without SUPABASE_URL / SERVICE_ROLE_KEY set first, so the env vars are
// set here and the module is imported dynamically - same bootstrap as
// dispatchLoadRelease.test.ts. Runs in package.json's second, --no-check
// `deno test` invocation (the sweep transitively imports domains/orders.ts,
// which carries pre-existing `deno check` type errors tracked in the baseline).
//
// WHAT IS REAL TS vs SQL-UNEXECUTED HERE. The sweep's stage selection
// (deadline vs 2x), the operationally-visible filter, the forced full-refund
// rate, and the "only act when the CAS reports it acted" wiring are REAL TS and
// are exercised directly. The two compare-and-swap functions themselves
// (ebuy_escalate_unaccepted_order / ebuy_auto_cancel_unaccepted_order) live in
// SQL (20260821_order_acceptance_deadline.sql) and CANNOT run here - there is
// no Postgres - so the rpc mock below reimplements their guard semantics, and
// the race / once-guard mutation checks target that mock to prove the tests
// genuinely depend on the compare-and-swap.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { sweepUnacceptedOrders } = await import('./acceptanceDeadlineSweep.ts');
if (typeof sweepUnacceptedOrders !== 'function') {
  throw new Error('sweepUnacceptedOrders is not exported as a function.');
}

const { serviceClient } = await import('./client.ts');

const DEADLINE_MINUTES = 8;
const DEADLINE_MS = DEADLINE_MINUTES * 60_000;
const RESTAURANT_ID = 'restaurant-accept-1';
const CUSTOMER_ID = 'customer-accept-1';
const CAPTURED_AMOUNT = 5000;

type Row = Record<string, unknown>;

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// Mirrors normalizeOrderStatus (_shared/orders.ts) AND the inline
// normalization the two CAS SQL functions use.
const normalizeStatus = (value: unknown) => {
  const status = typeof value === 'string' && value.trim() ? value.trim() : 'draft';
  if (status === 'pending' || status === 'confirmed') return 'placed';
  if (status === 'ready') return 'ready_for_pickup';
  return status;
};

// A minimal in-memory postgrest-shaped table: the subset the sweep and the
// notification helpers actually chain. Reads return COPIES (snapshots), the way
// a real round trip does - so the sweep's candidate snapshot cannot silently
// mutate when the rpc mock later writes the live row, which is exactly the
// stale-read gap the compare-and-swap exists to close.
const createTable = (initialRows: Row[]) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));
  const snapshot = (row: Row) => ({ ...row });

  const query = () => {
    let filtered = [...rows];
    let orderCol: string | null = null;
    let orderAscending = true;
    let limitN: number | null = null;
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
      is(col: string, val: unknown) {
        filtered = filtered.filter((row) => (row[col] ?? null) === val);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAscending = opts?.ascending !== false;
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: filtered[0] ? snapshot(filtered[0]) : null, error: null });
      },
      single() {
        return Promise.resolve({ data: filtered[0] ? snapshot(filtered[0]) : null, error: null });
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        let result = filtered;
        if (orderCol) {
          const col = orderCol;
          result = [...result].sort((a, b) => {
            // deno-lint-ignore no-explicit-any
            const av = a[col] as any;
            // deno-lint-ignore no-explicit-any
            const bv = b[col] as any;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return orderAscending ? cmp : -cmp;
          });
        }
        if (limitN !== null) {
          result = result.slice(0, limitN);
        }
        return Promise.resolve({ data: result.map(snapshot), error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    rows,
    select(_columns?: string) {
      return query();
    },
    async insert(payload: Row) {
      rows.push({ ...payload });
      return { error: null };
    },
    update(payload: Row) {
      const filters: Array<[string, unknown]> = [];
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          for (const row of rows) {
            if (filters.every(([col, val]) => row[col] === val)) {
              Object.assign(row, payload);
            }
          }
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
};

type SweepMockOptions = {
  /** Fires once, at the START of the auto-cancel CAS - BEFORE it reads the live
   * order row - to simulate a restaurant's accept committing in the window
   * between the sweep's snapshot read and the CAS's locked write. */
  beforeAutoCancelCas?: (tables: Record<string, ReturnType<typeof createTable>>) => void;
};

const buildOrderRow = (overrides: Row): Row => ({
  cancellation: null,
  createdAt: new Date().toISOString(),
  customerId: CUSTOMER_ID,
  deliveryAddress: '1 Test Street',
  deliveryLocation: null,
  fulfillmentType: 'delivery',
  id: 'order-x',
  needsAttention: false,
  payment: { capturedAmount: CAPTURED_AMOUNT, method: 'card', status: 'paid' },
  pricing: { total: CAPTURED_AMOUNT },
  restaurantId: RESTAURANT_ID,
  restaurantName: 'Test Kitchen',
  status: 'placed',
  timeline: { placedAt: new Date().toISOString() },
  updatedAt: new Date().toISOString(),
  ...overrides,
});

/** placedAt this many ms in the past, so age = ~ageMs at sweep time. */
const placedAgo = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();

const installMocks = (orders: Row[], options: SweepMockOptions = {}) => {
  const tables: Record<string, ReturnType<typeof createTable>> = {
    // The seeded acceptance-deadline config the loader reads. 8 minutes.
    PlatformSettings: createTable([
      { id: 'acceptanceDeadline', data: { acceptanceDeadlineMinutes: DEADLINE_MINUTES } },
    ]),
    CustomerOrder: createTable(orders),
    RestaurantRecord: createTable([{ id: RESTAURANT_ID, ownerId: null, missedOrderCount: 0 }]),
    DeliveryEvent: createTable([]),
    UserRole: createTable([]),
    UserAccount: createTable([]),
  };

  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  let autoCancelHookFired = false;

  const findOrder = (id: unknown) => tables.CustomerOrder.rows.find((row) => row.id === id) ?? null;

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const mock = tables[table];
    if (!mock) {
      throw new Error(`acceptanceDeadlineSweep.test.ts: unexpected table "${table}"`);
    }
    return mock;
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = (fn: string, params: Record<string, unknown>) => {
    rpcCalls.push({ fn, params });

    if (fn === 'ebuy_escalate_unaccepted_order') {
      // ---- MUTATION POINT (once-guard): reverting this to always escalate
      // (drop the `!needsAttention` term) must redden ONLY the "escalates
      // once" test - it re-pages on the second sweep. ----
      const order = findOrder(params.p_order_id);
      if (!order) return Promise.resolve({ data: [{ escalated: false }], error: null });
      const status = normalizeStatus(order.status);
      if (status !== 'placed' || order.needsAttention === true) {
        return Promise.resolve({ data: [{ escalated: false }], error: null });
      }
      order.needsAttention = true;
      order.updatedAt = new Date().toISOString();
      return Promise.resolve({ data: [{ escalated: true }], error: null });
    }

    if (fn === 'ebuy_auto_cancel_unaccepted_order') {
      if (options.beforeAutoCancelCas && !autoCancelHookFired) {
        autoCancelHookFired = true;
        options.beforeAutoCancelCas(tables);
      }
      const order = findOrder(params.p_order_id);
      if (!order) {
        return Promise.resolve({ data: [{ cancelled: false, restaurantId: null }], error: null });
      }
      const restaurantId = order.restaurantId as string;
      // ---- MUTATION POINT (CAS): reverting this to an unconditional cancel
      // (drop the status guard) must redden ONLY the race test - it cancels an
      // order that has since been accepted. ----
      const status = normalizeStatus(order.status);
      if (status !== 'placed') {
        return Promise.resolve({ data: [{ cancelled: false, restaurantId }], error: null });
      }
      order.status = 'cancelled';
      order.payment = params.p_payment;
      order.cancellation = params.p_cancellation;
      order.timeline = params.p_timeline;
      order.needsAttention = false;
      order.updatedAt = new Date().toISOString();
      const restaurant = tables.RestaurantRecord.rows.find((row) => row.id === restaurantId);
      if (restaurant) {
        restaurant.missedOrderCount = ((restaurant.missedOrderCount as number) ?? 0) + 1;
      }
      return Promise.resolve({ data: [{ cancelled: true, restaurantId }], error: null });
    }

    throw new Error(`acceptanceDeadlineSweep.test.ts: unexpected rpc "${fn}"`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response('{}', { status: 200 }))) as typeof fetch;

  const restore = () => {
    globalThis.fetch = originalFetch;
  };

  const order = () => tables.CustomerOrder.rows[0];
  const restaurant = () => tables.RestaurantRecord.rows[0];
  const events = (type: string) =>
    tables.DeliveryEvent.rows.filter((row) => row.eventType === type);

  return { events, order, restaurant, restore, rpcCalls, tables };
};

// ---------------------------------------------------------------------------
// deadline-1s: untouched (no escalation).
// ---------------------------------------------------------------------------
Deno.test('sweep: an order just under the deadline is not escalated', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-under', timeline: { placedAt: placedAgo(DEADLINE_MS - 3_000) } }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.escalated, 0, 'nothing escalated just under the deadline');
    expectEqual(result.cancelled, 0, 'nothing cancelled just under the deadline');
    expectEqual(mocks.order().needsAttention, false, 'needsAttention untouched');
    expectEqual(mocks.order().status, 'placed', 'status untouched');
    expectEqual(mocks.events('acceptance_deadline_escalated').length, 0, 'no escalation event');
    expectEqual(mocks.restaurant().missedOrderCount, 0, 'no missed-order count bump');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// at deadline: escalates once; a second sweep does not re-escalate.
// ---------------------------------------------------------------------------
Deno.test('sweep: an order past the deadline escalates exactly once across repeated sweeps', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-esc', timeline: { placedAt: placedAgo(DEADLINE_MS + 5_000) } }),
  ]);
  try {
    const first = await sweepUnacceptedOrders();
    expectEqual(first.escalated, 1, 'first sweep escalates once');
    expectEqual(mocks.order().needsAttention, true, 'the flag is set');
    expectEqual(mocks.order().status, 'placed', 'the order stays placed - a restaurant can still accept');
    expectEqual(mocks.events('acceptance_deadline_escalated').length, 1, 'one escalation event');

    const second = await sweepUnacceptedOrders();
    expectEqual(second.escalated, 0, 'the once-guard blocks a second escalation');
    expectEqual(
      mocks.events('acceptance_deadline_escalated').length,
      1,
      'still exactly one escalation event after the second sweep',
    );
    expectEqual(mocks.order().status, 'placed', 'still placed - escalation never cancels');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// at 2x: cancels + refunds in FULL + increments missedOrderCount.
// ---------------------------------------------------------------------------
Deno.test('sweep: an order past 2x the deadline is cancelled, fully refunded, and counted against the restaurant', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-cancel', timeline: { placedAt: placedAgo(DEADLINE_MS * 2 + 5_000) } }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.cancelled, 1, 'the order is cancelled');
    expectEqual(result.escalated, 0, 'auto-cancel takes precedence over escalation');
    expectEqual(mocks.order().status, 'cancelled', 'the order is now cancelled');

    const payment = mocks.order().payment as Record<string, unknown>;
    // ---- The refund is FULL: the amount equals the captured amount, not a
    // fractional rate. Reverting the sweep's forced rate to anything < 1 fails
    // exactly this assertion. ----
    expectEqual(payment.refundAmount, CAPTURED_AMOUNT, 'refund equals the captured amount (full, not fractional)');
    expectEqual(payment.status, 'refunded', 'payment marked refunded');

    const cancellation = mocks.order().cancellation as Record<string, unknown>;
    expectEqual(cancellation.refundRate, 1, 'the recorded refund rate is full');
    expectEqual(cancellation.reason, 'acceptance_deadline', 'cancellation reason recorded');

    expectEqual(mocks.restaurant().missedOrderCount, 1, 'the restaurant miss count is incremented once');
    expectEqual(mocks.events('order_auto_cancelled').length, 1, 'one auto-cancel event');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// an order already accepted (or any non-placed state): never touched.
// ---------------------------------------------------------------------------
Deno.test('sweep: an already-accepted order is never a candidate and is left untouched', async () => {
  const mocks = installMocks([
    buildOrderRow({
      id: 'order-accepted',
      status: 'accepted',
      timeline: { placedAt: placedAgo(DEADLINE_MS * 2 + 5_000) },
    }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.escalated, 0, 'an accepted order is not escalated');
    expectEqual(result.cancelled, 0, 'an accepted order is not cancelled');
    expectEqual(mocks.order().status, 'accepted', 'status untouched');
    expectEqual(mocks.restaurant().missedOrderCount, 0, 'no missed-order count bump');
    expectEqual(
      mocks.rpcCalls.some((call) => call.fn === 'ebuy_auto_cancel_unaccepted_order'),
      false,
      'the accepted order never reached the auto-cancel CAS',
    );
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// THE RACE: placed -> accepted between the sweep's read and its write. The CAS
// no-ops: no cancel, no refund, no missed-count bump.
// ---------------------------------------------------------------------------
Deno.test('sweep: an order that flips placed->accepted between the read and the write is not cancelled (CAS no-op)', async () => {
  const mocks = installMocks(
    [buildOrderRow({ id: 'order-race', timeline: { placedAt: placedAgo(DEADLINE_MS * 2 + 5_000) } })],
    {
      // The accept commits AFTER the sweep took its snapshot (status: placed)
      // but BEFORE the CAS reads the live row - exactly the window the
      // compare-and-swap exists to close.
      beforeAutoCancelCas: (tables) => {
        const order = tables.CustomerOrder.rows.find((row) => row.id === 'order-race');
        if (order) order.status = 'accepted';
      },
    },
  );
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.cancelled, 0, 'the raced order is not cancelled');
    expectEqual(result.skipped, 1, 'it is counted as skipped, not cancelled');
    expectEqual(mocks.order().status, 'accepted', 'the accept stands - the sweep wrote nothing');

    const payment = mocks.order().payment as Record<string, unknown>;
    expectEqual(payment.refundAmount, undefined, 'no refund was written');
    expectEqual(payment.status, 'paid', 'payment is still paid, not refunded');
    expectEqual(mocks.restaurant().missedOrderCount, 0, 'no missed-order count bump on a raced order');
    expectEqual(mocks.events('order_auto_cancelled').length, 0, 'no auto-cancel event');
  } finally {
    mocks.restore();
  }
});
