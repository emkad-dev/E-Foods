// Tests for the scheduled-order release sweep (Task 18 / G2). They drive the
// REAL sweep — sweepScheduledOrderReleases out of scheduledOrderReleaseSweep.ts
// — and the REAL acceptance-deadline sweep — sweepUnacceptedOrders out of
// acceptanceDeadlineSweep.ts — against a shared in-memory postgrest/rpc mock,
// and assert the STORED rows.
//
// Same bootstrap as acceptanceDeadlineSweep.test.ts: client.ts throws at module
// scope without the env vars, so they are set first and the modules are imported
// dynamically. Runs in the SECOND, --no-check `deno test` invocation.
//
// THE TEST THAT MATTERS MOST: "a just-released scheduled order is NOT
// immediately escalated/cancelled by the acceptance-deadline sweep." A scheduled
// order created THREE DAYS before its release is released now; because the
// release stamps timeline.placedAt = the release instant (not createdAt), the
// acceptance sweep sees age ~0 and leaves it alone. Reverting the release to
// stamp createdAt (the clock-starts-at-scheduling regression) makes the same
// order 3 days "overdue" the instant it releases, and this test reddens.
//
// MUTATION POINTS:
//   * clock-starts-at-release: in scheduledOrderReleaseSweep.ts, stamping
//     `placedAt: order.createdAt` (instead of the release instant) reddens
//     "a just-released order is not immediately auto-cancelled".
//   * release CAS: replacing updateOrderRecordIfStatus with an unconditional
//     update reddens "the release CAS does not resurrect a raced-to-cancelled
//     order" (an order cancelled between the candidate read and the write would
//     be flipped back to placed).

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { sweepScheduledOrderReleases } = await import('./scheduledOrderReleaseSweep.ts');
const { sweepUnacceptedOrders } = await import('./acceptanceDeadlineSweep.ts');
if (typeof sweepScheduledOrderReleases !== 'function') {
  throw new Error('sweepScheduledOrderReleases is not exported as a function.');
}
if (typeof sweepUnacceptedOrders !== 'function') {
  throw new Error('sweepUnacceptedOrders is not exported as a function.');
}
const { serviceClient } = await import('./client.ts');

// Must match acceptanceDeadlineSweep.test.ts's value: the acceptance-deadline
// config loader caches for 60s across test files in this shared process, so both
// files seed the SAME deadline to stay consistent regardless of run order.
const DEADLINE_MINUTES = 8;
const PREP_MINUTES = 30;
const PREP_MS = PREP_MINUTES * 60_000;
const RESTAURANT_ID = 'restaurant-sched-1';
const CUSTOMER_ID = 'customer-sched-1';
const CAPTURED_AMOUNT = 5000;

type Row = Record<string, unknown>;

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const normalizeStatus = (value: unknown) => {
  const status = typeof value === 'string' && value.trim() ? value.trim() : 'draft';
  if (status === 'pending' || status === 'confirmed') return 'placed';
  if (status === 'ready') return 'ready_for_pickup';
  return status;
};

type UpdateHook = () => void;

// In-memory postgrest-shaped table. Reads return COPIES (snapshots). The update
// builder supports `.select('id')` (returning the rows it matched) so the CAS
// updateOrderRecordIfStatus works, and an optional once-fired `beforeUpdate`
// hook to simulate a concurrent write landing between a sweep's candidate read
// and its CAS write.
const createTable = (initialRows: Row[], beforeUpdate?: UpdateHook) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));
  const snapshot = (row: Row) => ({ ...row });
  let hookFired = false;

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
      lte(col: string, val: unknown) {
        filtered = filtered.filter((row) => {
          const cell = row[col];
          if (cell === null || cell === undefined) return false;
          return (cell as string | number) <= (val as string | number);
        });
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
      returns() {
        return Promise.resolve({ data: filtered.map(snapshot), error: null });
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
      let selecting = false;
      const apply = () => {
        if (beforeUpdate && !hookFired) {
          hookFired = true;
          beforeUpdate();
        }
        const matched = rows.filter((row) => filters.every(([col, val]) => row[col] === val));
        for (const row of matched) {
          Object.assign(row, payload);
        }
        return matched;
      };
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        select(_cols?: string) {
          selecting = true;
          return builder;
        },
        then(resolve: (value: { data: Row[] | null; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          const matched = apply();
          const data = selecting ? matched.map((row) => ({ id: row.id })) : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
};

const buildScheduledOrder = (overrides: Row): Row => ({
  cancellation: null,
  createdAt: new Date().toISOString(),
  customerId: CUSTOMER_ID,
  deliveryAddress: '1 Test Street',
  deliveryLocation: null,
  fulfillmentType: 'delivery',
  id: 'order-sched',
  needsAttention: false,
  payment: { capturedAmount: CAPTURED_AMOUNT, method: 'card', status: 'paid' },
  pricing: { total: CAPTURED_AMOUNT },
  restaurantId: RESTAURANT_ID,
  restaurantName: 'Test Kitchen',
  status: 'scheduled',
  timeline: { scheduledAt: new Date().toISOString() },
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const installMocks = (orders: Row[], beforeReleaseUpdate?: UpdateHook) => {
  const tables: Record<string, ReturnType<typeof createTable>> = {
    PlatformSettings: createTable([
      { id: 'acceptanceDeadline', data: { acceptanceDeadlineMinutes: DEADLINE_MINUTES } },
      { id: 'scheduledOrders', data: { prepTimeMinutes: PREP_MINUTES } },
    ]),
    CustomerOrder: createTable(orders, beforeReleaseUpdate),
    RestaurantRecord: createTable([{ id: RESTAURANT_ID, ownerId: null, missedOrderCount: 0 }]),
    DeliveryEvent: createTable([]),
    UserRole: createTable([]),
    UserAccount: createTable([]),
  };

  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const findOrder = (id: unknown) => tables.CustomerOrder.rows.find((row) => row.id === id) ?? null;

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const mock = tables[table];
    if (!mock) {
      throw new Error(`scheduledOrderReleaseSweep.test.ts: unexpected table "${table}"`);
    }
    return mock;
  };

  // The acceptance sweep's two CAS functions, reimplemented with their guard
  // semantics (identical to acceptanceDeadlineSweep.test.ts).
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = (fn: string, params: Record<string, unknown>) => {
    rpcCalls.push({ fn, params });

    if (fn === 'ebuy_escalate_unaccepted_order') {
      const order = findOrder(params.p_order_id);
      if (!order) return Promise.resolve({ data: [{ escalated: false }], error: null });
      if (normalizeStatus(order.status) !== 'placed' || order.needsAttention === true) {
        return Promise.resolve({ data: [{ escalated: false }], error: null });
      }
      order.needsAttention = true;
      return Promise.resolve({ data: [{ escalated: true }], error: null });
    }

    if (fn === 'ebuy_auto_cancel_unaccepted_order') {
      const order = findOrder(params.p_order_id);
      if (!order) return Promise.resolve({ data: [{ cancelled: false, restaurantId: null }], error: null });
      const restaurantId = order.restaurantId as string;
      if (normalizeStatus(order.status) !== 'placed') {
        return Promise.resolve({ data: [{ cancelled: false, restaurantId }], error: null });
      }
      order.status = 'cancelled';
      order.payment = params.p_payment;
      order.cancellation = params.p_cancellation;
      order.timeline = params.p_timeline;
      const restaurant = tables.RestaurantRecord.rows.find((row) => row.id === restaurantId);
      if (restaurant) {
        restaurant.missedOrderCount = ((restaurant.missedOrderCount as number) ?? 0) + 1;
      }
      return Promise.resolve({ data: [{ cancelled: true, restaurantId }], error: null });
    }

    if (fn === 'ebuy_release_promo_redemption') {
      return Promise.resolve({ data: null, error: null });
    }

    throw new Error(`scheduledOrderReleaseSweep.test.ts: unexpected rpc "${fn}"`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response('{}', { status: 200 }))) as typeof fetch;

  return {
    tables,
    rpcCalls,
    order: () => tables.CustomerOrder.rows[0],
    restaurant: () => tables.RestaurantRecord.rows[0],
    events: (type: string) => tables.DeliveryEvent.rows.filter((row) => row.eventType === type),
    restore: () => { globalThis.fetch = originalFetch; },
  };
};

// ---------------------------------------------------------------------------
// Release timing: before scheduledFor − prepTime, nothing releases.
// ---------------------------------------------------------------------------
Deno.test('release sweep: an order not yet at scheduledFor − prepTime is not released', async () => {
  // Release moment = scheduledFor − prep. Put scheduledFor far enough out that
  // the release moment is still in the future.
  const scheduledFor = new Date(Date.now() + PREP_MS + 10 * 60_000).toISOString();
  const mocks = installMocks([buildScheduledOrder({ scheduledFor })]);
  try {
    const result = await sweepScheduledOrderReleases();
    expectEqual(result.released, 0, 'nothing released before the release moment');
    expectEqual(mocks.order().status, 'scheduled', 'the order is still scheduled');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// Release timing: at/after scheduledFor − prepTime, releases once; a second
// sweep is a no-op; placedAt is stamped at release (not createdAt).
// ---------------------------------------------------------------------------
Deno.test('release sweep: at scheduledFor − prepTime the order releases once and a second sweep is a no-op', async () => {
  const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
  const scheduledFor = new Date(Date.now() + PREP_MS - 5 * 60_000).toISOString(); // due now
  const mocks = installMocks([buildScheduledOrder({ createdAt, scheduledFor })]);
  try {
    const first = await sweepScheduledOrderReleases();
    expectEqual(first.released, 1, 'the due order releases');
    expectEqual(mocks.order().status, 'placed', 'status flipped to placed');
    const timeline = mocks.order().timeline as Row;
    // The clock is stamped at release, NOT at createdAt.
    const placedAtMs = Date.parse(timeline.placedAt as string);
    expectEqual(placedAtMs > Date.parse(createdAt) + 24 * 60 * 60 * 1000, true, 'placedAt is fresh (release), not createdAt');
    expectEqual(mocks.events('scheduled_order_released').length, 1, 'one release event');

    const second = await sweepScheduledOrderReleases();
    expectEqual(second.released, 0, 'a second sweep releases nothing');
    expectEqual(mocks.events('scheduled_order_released').length, 1, 'still exactly one release event');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// CAS: an order that raced to 'cancelled' between the candidate read and the
// write is NOT flipped back to 'placed'. Reverting the CAS to an unconditional
// update reddens this.
// ---------------------------------------------------------------------------
Deno.test('release sweep: the CAS does not resurrect an order that raced to cancelled', async () => {
  const scheduledFor = new Date(Date.now() + PREP_MS - 5 * 60_000).toISOString(); // due now
  let order: Row | undefined;
  const mocks = installMocks([buildScheduledOrder({ id: 'order-race', scheduledFor })], () => {
    // The cancel commits AFTER the sweep took its candidate snapshot but BEFORE
    // the CAS write — exactly the window the compare-and-swap exists to close.
    if (order) order.status = 'cancelled';
  });
  order = mocks.order();
  try {
    const result = await sweepScheduledOrderReleases();
    expectEqual(result.released, 0, 'the raced order is not released');
    expectEqual(mocks.order().status, 'cancelled', 'the cancel stands — the sweep did not resurrect it to placed');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// THE ACCEPTANCE-DEADLINE INTERACTION (the load-bearing test): a scheduled
// order created long ago and released now is NOT immediately escalated or
// auto-cancelled by the acceptance-deadline sweep.
// ---------------------------------------------------------------------------
Deno.test('interaction: a just-released scheduled order is NOT immediately escalated or auto-cancelled', async () => {
  // Created 3 DAYS ago — far beyond 2× the acceptance deadline — but scheduled
  // for release now. If the acceptance clock keyed off createdAt this would be
  // instantly auto-cancelled + refunded.
  const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const scheduledFor = new Date(Date.now() + PREP_MS - 60_000).toISOString(); // due now
  const mocks = installMocks([buildScheduledOrder({ createdAt, scheduledFor })]);
  try {
    // 1. Release: scheduled → placed, placedAt stamped NOW.
    const release = await sweepScheduledOrderReleases();
    expectEqual(release.released, 1, 'the scheduled order releases');
    expectEqual(mocks.order().status, 'placed', 'released into placed');

    // 2. Acceptance-deadline sweep runs immediately after (same drainer minute).
    const acceptance = await sweepUnacceptedOrders();
    expectEqual(acceptance.cancelled, 0, 'a just-released order is NOT auto-cancelled');
    expectEqual(acceptance.escalated, 0, 'a just-released order is NOT escalated');
    expectEqual(mocks.order().status, 'placed', 'the order is still placed, awaiting the restaurant');

    const payment = mocks.order().payment as Row;
    expectEqual(payment.refundAmount, undefined, 'no refund was written');
    expectEqual(payment.status, 'paid', 'payment is still paid, not refunded');
    expectEqual(mocks.restaurant().missedOrderCount, 0, 'the restaurant is not charged a miss');
    expectEqual(mocks.events('order_auto_cancelled').length, 0, 'no auto-cancel event');
  } finally {
    mocks.restore();
  }
});
