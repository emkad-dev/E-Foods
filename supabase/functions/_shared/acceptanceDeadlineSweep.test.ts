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
const { resetPushSoundChannelGateCache } = await import('./notifications.ts');
const { loadAcceptanceDeadlineConfig } = await import('./platformSettings.ts');

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
// A PostgREST column, including a JSON path like 'payment->>status' (text, or
// null when absent) - the candidate query filters to paid orders on one.
// Nested paths too ('payment->refundExecution->>status'): '->' keeps JSON, a
// final '->>' gives text.
const readColumn = (row: Row, column: string): unknown => {
  const textMode = column.includes('->>');
  const [base, ...path] = column.split(/->>|->/);
  let value: unknown = row[base];
  for (const key of path) {
    value = value && typeof value === 'object' ? (value as Row)[key] : undefined;
  }
  if (path.length === 0) return value;
  if (value === undefined || value === null) return null;
  return textMode ? (typeof value === 'object' ? JSON.stringify(value) : String(value)) : value;
};

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
        filtered = filtered.filter((row) => readColumn(row, col) === val);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((row) => vals.includes(readColumn(row, col)));
        return builder;
      },
      is(col: string, val: unknown) {
        filtered = filtered.filter((row) => (readColumn(row, col) ?? null) === val);
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
    // OperationalAlert rows are keyed on dedupeKey, as recordOperationalAlert upserts them.
    async upsert(payload: Row, options?: { onConflict?: string }) {
      const key = options?.onConflict ?? 'id';
      const existing = rows.find((row) => row[key] === payload[key]);
      if (existing) Object.assign(existing, payload);
      else rows.push({ ...payload });
      return { error: null };
    },
    update(payload: Row) {
      const filters: Array<[string, unknown]> = [];
      // Every filter is applied together at execution, the way Postgres
      // evaluates the WHERE; `.select()` surfaces the matched rows.
      const apply = () => {
        const matched = rows.filter((row) => filters.every(([col, val]) => (readColumn(row, col) ?? null) === val));
        for (const row of matched) Object.assign(row, payload);
        return matched.map(snapshot);
      };
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        // `.is(col, null)`: the column (or JSON key) is null or absent.
        is(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        select(_columns?: string) {
          return {
            then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
              return Promise.resolve({ data: apply(), error: null }).then(resolve, reject);
            },
          };
        },
        then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          apply();
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
  /** The configured acceptance deadline. Defaults to DEADLINE_MINUTES. */
  deadlineMinutes?: number;
  /** The push_sound_channels FeatureFlag. Absent (off) by default. */
  soundChannels?: boolean;
  /** The auto_refunds FeatureFlag. Absent (off) by default. */
  autoRefunds?: boolean;
  /** What api.paystack.co/refund answers. */
  paystackRefund?: () => Response;
};

// The restaurant's owner and a linked staff member, each with a partner push
// token: the recipients loadRestaurantRecipientUserIds resolves for the
// paid-order push, and so for the reminder.
const RESTAURANT_USERS = [
  { uid: 'partner-owner-1', token: 'ExponentPushToken[owner-1]' },
  { uid: 'partner-staff-1', token: 'ExponentPushToken[staff-1]' },
];

type PushMessage = { body: string; channelId?: string; data: Row; sound?: string | null; title: string; to: string };

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
      {
        id: 'acceptanceDeadline',
        data: { acceptanceDeadlineMinutes: options.deadlineMinutes ?? DEADLINE_MINUTES },
      },
    ]),
    CustomerOrder: createTable(orders),
    RestaurantRecord: createTable([{ id: RESTAURANT_ID, ownerId: null, missedOrderCount: 0 }]),
    DeliveryEvent: createTable([]),
    OperationalAlert: createTable([]),
    PushDevice: createTable([]),
    UserRole: createTable(
      RESTAURANT_USERS.map((user) => ({ restaurantId: RESTAURANT_ID, role: 'restaurant', userId: user.uid }))
    ),
    UserAccount: createTable(RESTAURANT_USERS.map((user) => ({ expoPushToken: user.token, uid: user.uid }))),
    // Where an accepted push schedules its deferred receipt check.
    queue_notifications: createTable([]),
  };

  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  let autoCancelHookFired = false;

  const findOrder = (id: unknown) => tables.CustomerOrder.rows.find((row) => row.id === id) ?? null;

  resetPushSoundChannelGateCache();
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'FeatureFlag') {
      // loadFeatureFlagMap: select(...).returns<T>()
      const rows = [
        ...(options.soundChannels === undefined ? [] : [{ key: 'push_sound_channels', enabled: options.soundChannels }]),
        ...(options.autoRefunds === undefined ? [] : [{ key: 'auto_refunds', enabled: options.autoRefunds }]),
      ];
      return { select: () => ({ returns: () => Promise.resolve({ data: rows, error: null }) }) };
    }
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

    // The promo release and the admin-email dedupe limiter: recorded above, no-op here.
    if (fn === 'ebuy_release_promo_redemption' || fn === 'auth_rl_hit') {
      return Promise.resolve({ data: [], error: null });
    }

    throw new Error(`acceptanceDeadlineSweep.test.ts: unexpected rpc "${fn}"`);
  };

  // Every Expo push the sweep sends, as the messages it posted.
  const pushes: PushMessage[] = [];
  // Every Paystack refund request body (never a live call).
  const paystackRefunds: Row[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://api.paystack.co/refund?')) {
      return Promise.resolve(new Response(JSON.stringify({ status: true, data: [], meta: { pageCount: 1 } }), { status: 200 }));
    }
    if (String(input) === 'https://api.paystack.co/refund') {
      paystackRefunds.push(JSON.parse(String(init?.body ?? '{}')));
      return Promise.resolve(
        options.paystackRefund?.() ??
          new Response(JSON.stringify({ status: true, data: { id: 901, status: 'pending' } }), { status: 200 })
      );
    }
    if (String(input).includes('exp.host') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body);
      if (Array.isArray(body)) {
        pushes.push(...(body as PushMessage[]));
        // One ok ticket per message, as Expo answers an accepted batch.
        const tickets = body.map((_, index) => ({ id: `ticket-${pushes.length}-${index}`, status: 'ok' }));
        return Promise.resolve(new Response(JSON.stringify({ data: tickets }), { status: 200 }));
      }
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;

  const restore = () => {
    globalThis.fetch = originalFetch;
  };

  const order = () => tables.CustomerOrder.rows[0];
  const restaurant = () => tables.RestaurantRecord.rows[0];
  const events = (type: string) =>
    tables.DeliveryEvent.rows.filter((row) => row.eventType === type);

  const reminders = () => pushes.filter((push) => push.data?.type === 'acceptance_reminder');

  return { events, order, paystackRefunds, pushes, reminders, restaurant, restore, rpcCalls, tables };
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

// ---------------------------------------------------------------------------
// The clock starts at PAYMENT. Production order c7655e4a was created 11:05:19,
// paid 11:14:55 by bank transfer and escalated at 11:15:03 - 8 s after payment.
// ---------------------------------------------------------------------------
Deno.test('sweep: a slow bank transfer is not overdue until the deadline after PAYMENT', async () => {
  const mocks = installMocks([
    buildOrderRow({
      id: 'order-slow-transfer',
      createdAt: placedAgo(10 * 60_000 + 8_000),
      payment: { capturedAmount: CAPTURED_AMOUNT, method: 'bank_transfer', paidAt: placedAgo(8_000), status: 'paid' },
      timeline: { placedAt: placedAgo(10 * 60_000 + 8_000), paidAt: placedAgo(8_000) },
    }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.escalated, 0, 'paid 8 s ago, so not escalated even though created 10 minutes ago');
    expectEqual(mocks.order().needsAttention, false, 'no attention flag');
    expectEqual(mocks.events('acceptance_deadline_escalated').length, 0, 'no escalation event');

    // Same order, but paid a full deadline ago: now it is overdue.
    mocks.order().timeline = {
      placedAt: placedAgo(10 * 60_000 + DEADLINE_MS),
      paidAt: placedAgo(DEADLINE_MS + 5_000),
    };
    const later = await sweepUnacceptedOrders();
    expectEqual(later.escalated, 1, 'escalates once the deadline after payment has passed');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: payment.paidAt is used when timeline.paidAt is absent', async () => {
  const mocks = installMocks([
    buildOrderRow({
      id: 'order-payment-paidat',
      payment: { capturedAmount: CAPTURED_AMOUNT, method: 'card', paidAt: placedAgo(5_000), status: 'paid' },
      timeline: { placedAt: placedAgo(DEADLINE_MS * 3) },
    }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.escalated, 0, 'paid 5 s ago');
    expectEqual(result.cancelled, 0, 'and not auto-cancelled either');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: a legacy row with no paidAt anywhere is measured from creation', async () => {
  const mocks = installMocks([
    buildOrderRow({
      id: 'order-legacy',
      createdAt: placedAgo(DEADLINE_MS + 5_000),
      timeline: {},
    }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.escalated, 1, 'created a deadline ago and never stamped paidAt: overdue');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: a scheduled order paid days ago is measured from its release, not its payment', async () => {
  const mocks = installMocks([
    buildOrderRow({
      id: 'order-scheduled',
      payment: { capturedAmount: CAPTURED_AMOUNT, method: 'card', paidAt: placedAgo(2 * 24 * 3_600_000), status: 'paid' },
      timeline: { placedAt: placedAgo(5_000), paidAt: placedAgo(2 * 24 * 3_600_000) },
    }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.escalated, 0, 'just released, kitchen has its full time');
    expectEqual(result.cancelled, 0, 'and is not auto-cancelled');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: a future paid_at cannot delay escalation', async () => {
  const mocks = installMocks([
    buildOrderRow({
      id: 'order-future-paid',
      createdAt: placedAgo(DEADLINE_MS + 60_000),
      payment: { capturedAmount: CAPTURED_AMOUNT, method: 'card', paidAt: new Date(Date.now() + 3_600_000).toISOString(), status: 'paid' },
      timeline: { placedAt: placedAgo(DEADLINE_MS + 60_000) },
    }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.escalated, 1, 'an impossible future paidAt is ignored; measured from placement');
  } finally {
    mocks.restore();
  }
});

// The batch is the oldest ACCEPTANCE_SWEEP_LIMIT (100) placed rows. Before the
// candidate query filtered to paid orders, 100 stale unpaid checkouts filled it
// every minute and the paid order behind them was never escalated.
Deno.test('sweep: 100 older unpaid orders cannot starve a paid order of escalation', async () => {
  const unpaid = Array.from({ length: 100 }, (_, index) =>
    buildOrderRow({
      id: `order-unpaid-${String(index).padStart(3, '0')}`,
      createdAt: placedAgo(24 * 3_600_000 + index * 1_000),
      payment: { method: 'card', status: index % 2 === 0 ? 'pending' : 'failed' },
      timeline: { placedAt: placedAgo(24 * 3_600_000 + index * 1_000) },
    })
  );
  const paid = buildOrderRow({
    id: 'order-paid-behind',
    createdAt: placedAgo(DEADLINE_MS + 5_000),
    timeline: { placedAt: placedAgo(DEADLINE_MS + 5_000) },
  });
  const mocks = installMocks([...unpaid, paid]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.escalated, 1, 'the paid order is escalated');
    expectEqual(result.cancelled, 0, 'no unpaid order is auto-cancelled with a refund');
    const paidRow = mocks.tables.CustomerOrder.rows.find((row) => row.id === 'order-paid-behind');
    expectEqual(paidRow?.needsAttention, true, 'the paid order is flagged');
    expectEqual(
      mocks.tables.CustomerOrder.rows.filter((row) => row.needsAttention === true).length,
      1,
      'no unpaid order was touched'
    );
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// A paid auto-cancel records a refund that moves no money, and the SQL clears
// needsAttention: the sweep must re-flag it and alert admins so someone pays
// the customer back.
// ---------------------------------------------------------------------------
const refundAlertsFor = (mocks: ReturnType<typeof installMocks>) =>
  mocks.tables.OperationalAlert.rows.filter((row) => row.alertType === 'manual_refund_required');
const adminEmailsFor = (mocks: ReturnType<typeof installMocks>, orderId: string) =>
  mocks.rpcCalls.filter(
    (call) => call.fn === 'auth_rl_hit' && call.params.p_key === `admin-alert-email:manual_refund_required:${orderId}`
  );
const promoReleasesFor = (mocks: ReturnType<typeof installMocks>, orderId: string) =>
  mocks.rpcCalls.filter((call) => call.fn === 'ebuy_release_promo_redemption' && call.params.p_order_id === orderId);

Deno.test('sweep: a paid auto-cancel is flagged and alerted exactly once across repeated sweeps', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-refund-flag', timeline: { placedAt: placedAgo(DEADLINE_MS * 2 + 5_000) } }),
  ]);
  try {
    const first = await sweepUnacceptedOrders();
    expectEqual(first.cancelled, 1, 'the order is cancelled');
    expectEqual(mocks.order().status, 'cancelled', 'cancelled');
    expectEqual((mocks.order().payment as Row).refundAmount, CAPTURED_AMOUNT, 'the SQL wrote the full refund');
    expectEqual(mocks.order().needsAttention, true, 'flagged after the SQL cleared it');

    const alerts = refundAlertsFor(mocks);
    expectEqual(alerts.length, 1, 'one manual-refund OperationalAlert');
    expectEqual(alerts[0].subjectId, 'order-refund-flag', 'alert names the order');
    expectEqual(alerts[0].severity, 'high', 'high severity');
    expectEqual(String(alerts[0].details).includes('did not accept it in time'), true, 'admin wording names the cause');
    expectEqual(String(alerts[0].details).includes('A refund of'), true, 'alert names the recorded refund');
    expectEqual(adminEmailsFor(mocks, 'order-refund-flag').length, 1, 'admins emailed once');
    expectEqual(promoReleasesFor(mocks, 'order-refund-flag').length, 1, 'promo released once (by the announcement)');

    const second = await sweepUnacceptedOrders();
    expectEqual(second.cancelled, 0, 'a second sweep cancels nothing');
    expectEqual(refundAlertsFor(mocks).length, 1, 'still one alert');
    expectEqual(adminEmailsFor(mocks, 'order-refund-flag').length, 1, 'still one admin email');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: an auto-cancelled order that changed before the flag write is left alone', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-refund-lost', timeline: { placedAt: placedAgo(DEADLINE_MS * 2 + 5_000) } }),
  ]);
  // Another writer commits between the sweep's read of the cancelled row and its
  // guarded flag write: updatedAt moves, so the guard no longer matches.
  const update = mocks.tables.CustomerOrder.update;
  let fired = false;
  mocks.tables.CustomerOrder.update = (payload: Row) => {
    if (!fired && payload.needsAttention === true) {
      fired = true;
      mocks.order().updatedAt = new Date(Date.now() + 60_000).toISOString();
    }
    return update(payload);
  };
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.cancelled, 1, 'the cancel itself committed');
    expectEqual(fired, true, 'the flag write was attempted');
    expectEqual(mocks.order().needsAttention, false, 'no flag written over the newer row');
    expectEqual(refundAlertsFor(mocks).length, 0, 'no alert');
    expectEqual(adminEmailsFor(mocks, 'order-refund-lost').length, 0, 'no admin email');
    expectEqual(promoReleasesFor(mocks, 'order-refund-lost').length, 1, 'the promo slot is still released');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// The half-deadline reminder: one push to the restaurant before admin is paged.
// ---------------------------------------------------------------------------
const HALF_DEADLINE_MS = DEADLINE_MS / 2;
const reminderStamp = (mocks: ReturnType<typeof installMocks>) =>
  (mocks.order().timeline as Row | null)?.acceptanceReminderSentAt;

Deno.test('reminder: at half the deadline the restaurant is reminded once, on the paid-order push path', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-remind-abc123', timeline: { placedAt: placedAgo(HALF_DEADLINE_MS + 5_000) } }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.reminded, 1, 'one reminder');
    expectEqual(result.escalated, 0, 'not escalated yet');
    expectEqual(typeof reminderStamp(mocks), 'string', 'the once-stamp is written');
    expectEqual(typeof (mocks.order().timeline as Row).placedAt, 'string', 'the rest of the timeline is kept');
    expectEqual(mocks.order().needsAttention, false, 'needsAttention untouched');
    expectEqual(mocks.order().status, 'placed', 'still placed');

    const pushes = mocks.reminders();
    expectEqual(
      pushes.map((push) => push.to).sort().join(','),
      RESTAURANT_USERS.map((user) => user.token).sort().join(','),
      'owner and staff each get it'
    );
    const push = pushes[0];
    expectEqual(push.title, 'Order waiting: accept now', 'title');
    expectEqual(
      push.body,
      'Order ABC123 has waited 4 minutes. Accept it now or it will be cancelled and refunded in 12 minutes.',
      'body computed from the 8-minute config: cancel is at 16 minutes'
    );
    // Sound-channel flag off (the default): exactly the legacy message.
    expectEqual(push.channelId, undefined, 'legacy: no channel, as the paid-order push had before');
    expectEqual(push.sound, 'default', 'legacy: default sound');
    expectEqual(push.data.app, 'partner', 'addressed to the partner app');
    expectEqual(push.data.routeKey, 'partner_order_detail', 'routes to the order');
    expectEqual(push.data.path, '/order/order-remind-abc123', 'opens the order screen');
    expectEqual(push.data.orderId, 'order-remind-abc123', 'carries the order id');
  } finally {
    mocks.restore();
  }
});

Deno.test('reminder: with the sound-channel flag on it rides the urgent "New orders" channel', async () => {
  const mocks = installMocks(
    [buildOrderRow({ id: 'order-remind-snd123', timeline: { placedAt: placedAgo(HALF_DEADLINE_MS + 5_000) } })],
    { soundChannels: true }
  );
  try {
    await sweepUnacceptedOrders();
    const pushes = mocks.reminders();
    expectEqual(pushes.length, RESTAURANT_USERS.length, 'owner and staff each get it');
    for (const push of pushes) {
      expectEqual(push.channelId, 'new_orders', 'urgent channel');
      expectEqual(push.sound, 'feasty_urgent.wav', 'urgent sound, which iOS reads from the payload');
    }
  } finally {
    mocks.restore();
  }
});

Deno.test('reminder: not sent before half the deadline', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-remind-early', timeline: { placedAt: placedAgo(HALF_DEADLINE_MS - 5_000) } }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.reminded, 0, 'no reminder');
    expectEqual(result.skipped, 1, 'counted as not yet due');
    expectEqual(reminderStamp(mocks), undefined, 'no stamp');
    expectEqual(mocks.reminders().length, 0, 'no push');
  } finally {
    mocks.restore();
  }
});

Deno.test('reminder: not sent twice over two sweeps', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-remind-twice', timeline: { placedAt: placedAgo(HALF_DEADLINE_MS + 5_000) } }),
  ]);
  try {
    const first = await sweepUnacceptedOrders();
    expectEqual(first.reminded, 1, 'first sweep reminds');
    const stamp = reminderStamp(mocks);

    const second = await sweepUnacceptedOrders();
    expectEqual(second.reminded, 0, 'second sweep does not');
    expectEqual(mocks.reminders().length, RESTAURANT_USERS.length, 'still one push per recipient');
    expectEqual(reminderStamp(mocks), stamp, 'the stamp is not rewritten');
  } finally {
    mocks.restore();
  }
});

Deno.test('reminder: not sent for an unpaid order', async () => {
  const mocks = installMocks([
    buildOrderRow({
      id: 'order-remind-unpaid',
      payment: { method: 'bank_transfer', status: 'pending' },
      timeline: { placedAt: placedAgo(HALF_DEADLINE_MS + 5_000) },
    }),
  ]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.reminded, 0, 'no reminder');
    expectEqual(reminderStamp(mocks), undefined, 'no stamp');
    expectEqual(mocks.reminders().length, 0, 'no push');
  } finally {
    mocks.restore();
  }
});

/** Runs `change` once, just before the reminder's guarded write is evaluated. */
const beforeReminderWrite = (mocks: ReturnType<typeof installMocks>, change: () => void) => {
  const update = mocks.tables.CustomerOrder.update;
  let fired = false;
  mocks.tables.CustomerOrder.update = (payload: Row) => {
    if (!fired && (payload.timeline as Row | undefined)?.acceptanceReminderSentAt) {
      fired = true;
      change();
    }
    return update(payload);
  };
  return () => fired;
};

Deno.test('reminder: a lost guard sends nothing (another write moved updatedAt)', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-remind-lost', timeline: { placedAt: placedAgo(HALF_DEADLINE_MS + 5_000) } }),
  ]);
  const fired = beforeReminderWrite(mocks, () => {
    mocks.order().updatedAt = new Date(Date.now() + 60_000).toISOString();
  });
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(fired(), true, 'the write was attempted');
    expectEqual(result.reminded, 0, 'not counted');
    expectEqual(reminderStamp(mocks), undefined, 'no stamp written over the newer row');
    expectEqual(mocks.reminders().length, 0, 'no push');
  } finally {
    mocks.restore();
  }
});

Deno.test('reminder: a lost guard sends nothing (a concurrent sweep stamped it first)', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-remind-raced', timeline: { placedAt: placedAgo(HALF_DEADLINE_MS + 5_000) } }),
  ]);
  const otherStamp = new Date(Date.now() - 1_000).toISOString();
  // The other run's stamp lands without moving updatedAt, so only the
  // key-still-absent guard can stop this run from sending a second push.
  beforeReminderWrite(mocks, () => {
    mocks.order().timeline = { ...(mocks.order().timeline as Row), acceptanceReminderSentAt: otherStamp };
  });
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.reminded, 0, 'not counted');
    expectEqual(reminderStamp(mocks), otherStamp, 'the winning stamp stands');
    expectEqual(mocks.reminders().length, 0, 'no push from the loser');
  } finally {
    mocks.restore();
  }
});

Deno.test('reminder: a lost guard sends nothing (the restaurant accepted in between)', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-remind-accepted', timeline: { placedAt: placedAgo(HALF_DEADLINE_MS + 5_000) } }),
  ]);
  // updatedAt is left as read, so only the status guard can stop the write.
  beforeReminderWrite(mocks, () => {
    mocks.order().status = 'accepted';
  });
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.reminded, 0, 'not counted');
    expectEqual(mocks.order().status, 'accepted', 'the accept stands');
    expectEqual(reminderStamp(mocks), undefined, 'no stamp');
    expectEqual(mocks.reminders().length, 0, 'no push');
  } finally {
    mocks.restore();
  }
});

Deno.test('reminder: escalation at the deadline and auto-cancel at 2x still fire after a reminder', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-remind-then-esc', timeline: { placedAt: placedAgo(HALF_DEADLINE_MS + 5_000) } }),
  ]);
  try {
    const first = await sweepUnacceptedOrders();
    expectEqual(first.reminded, 1, 'reminded at half the deadline');
    const stamp = reminderStamp(mocks);

    // The clock moves on to the deadline. The reminder bumped updatedAt and the
    // timeline; the escalation CAS (like its SQL) keys on status and
    // needsAttention only, so it must still act.
    mocks.order().timeline = { ...(mocks.order().timeline as Row), placedAt: placedAgo(DEADLINE_MS + 5_000) };
    const second = await sweepUnacceptedOrders();
    expectEqual(second.escalated, 1, 'escalates at the deadline');
    expectEqual(second.reminded, 0, 'no second reminder');
    expectEqual(mocks.order().needsAttention, true, 'flagged for admin');
    expectEqual(mocks.events('acceptance_deadline_escalated').length, 1, 'one escalation event');

    mocks.order().timeline = { ...(mocks.order().timeline as Row), placedAt: placedAgo(DEADLINE_MS * 2 + 5_000) };
    const third = await sweepUnacceptedOrders();
    expectEqual(third.cancelled, 1, 'auto-cancels at 2x');
    expectEqual(mocks.order().status, 'cancelled', 'cancelled');
    expectEqual(reminderStamp(mocks), stamp, 'the cancel keeps the reminder stamp in the timeline');
    expectEqual(mocks.reminders().length, RESTAURANT_USERS.length, 'still only the one reminder');
  } finally {
    mocks.restore();
  }
});

// loadAcceptanceDeadlineConfig caches the config for 60 s at module scope, so
// an earlier test's 8 minutes would still be served. The clock is moved past
// that cache for this test (placedAgo reads the same clock), and afterwards the
// 8-minute config is re-cached further ahead still so no later test inherits 20.
Deno.test('reminder: a configured 20-minute deadline reminds at 10 minutes, not at 4', async () => {
  const realNow = Date.now;
  const shiftClock = (offsetMs: number) => {
    Date.now = () => realNow() + offsetMs;
  };
  shiftClock(10 * 60_000);
  const mocks = installMocks(
    [buildOrderRow({ id: 'order-remind-twenty', timeline: { placedAt: placedAgo(4 * 60_000 + 5_000) } })],
    { deadlineMinutes: 20 }
  );
  try {
    const atFour = await sweepUnacceptedOrders();
    expectEqual(atFour.reminded, 0, 'the default half-deadline does not apply');

    mocks.order().timeline = { placedAt: placedAgo(10 * 60_000 - 5_000) };
    const justBefore = await sweepUnacceptedOrders();
    expectEqual(justBefore.reminded, 0, 'not at 9m55s');

    mocks.order().timeline = { placedAt: placedAgo(10 * 60_000 + 5_000) };
    const atTen = await sweepUnacceptedOrders();
    expectEqual(atTen.reminded, 1, 'reminded at 10 minutes');
    expectEqual(
      mocks.reminders()[0]?.body,
      'Order TWENTY has waited 10 minutes. Accept it now or it will be cancelled and refunded in 30 minutes.',
      'minutes follow the config: cancel is at 40 minutes'
    );
  } finally {
    const settings = mocks.tables.PlatformSettings.rows[0];
    settings.data = { acceptanceDeadlineMinutes: DEADLINE_MINUTES };
    shiftClock(30 * 60_000);
    await loadAcceptanceDeadlineConfig();
    Date.now = realNow;
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// auto_refunds: the paid auto-cancel's recorded refund is sent through
// Paystack only when the flag is on, and a Paystack failure never undoes the
// cancel or the manual alert.
// ---------------------------------------------------------------------------
const paystackOrder = (id: string) =>
  buildOrderRow({
    id,
    payment: {
      capturedAmount: CAPTURED_AMOUNT,
      method: 'card',
      paidAt: placedAgo(DEADLINE_MS * 2 + 5_000),
      paystackResponse: { amount: CAPTURED_AMOUNT * 100, id: 8001 },
      provider: 'paystack',
      reference: `FEASTY-CRD-${id}`,
      status: 'paid',
    },
    timeline: { placedAt: placedAgo(DEADLINE_MS * 2 + 5_000) },
  });

Deno.test('sweep: auto_refunds off (default) sends nothing to Paystack', async () => {
  Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');
  Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_not_real');
  const mocks = installMocks([paystackOrder('order-auto-off')]);
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.cancelled, 1, 'cancelled');
    expectEqual(mocks.paystackRefunds.length, 0, 'no Paystack refund');
    expectEqual((mocks.order().payment as Row).refundExecution, undefined, 'no execution');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: auto_refunds on sends the recorded refund once, across repeated sweeps', async () => {
  Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');
  Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_not_real');
  const mocks = installMocks([paystackOrder('order-auto-on')], { autoRefunds: true });
  try {
    await sweepUnacceptedOrders();
    await sweepUnacceptedOrders();
    expectEqual(mocks.paystackRefunds.length, 1, 'one Paystack refund');
    expectEqual(mocks.paystackRefunds[0].amount, CAPTURED_AMOUNT * 100, 'the recorded amount in kobo');
    expectEqual(((mocks.order().payment as Row).refundExecution as Row).status, 'pending', 'execution recorded');
    expectEqual(refundAlertsFor(mocks).length, 1, 'the manual alert is still raised');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: auto_refunds on and Paystack refuses: the cancel stands, flagged, with a refund_failed alert', async () => {
  Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');
  Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_not_real');
  const mocks = installMocks([paystackOrder('order-auto-fail')], {
    autoRefunds: true,
    paystackRefund: () => new Response(JSON.stringify({ status: false, message: 'Insufficient balance' }), { status: 400 }),
  });
  try {
    const result = await sweepUnacceptedOrders();
    expectEqual(result.cancelled, 1, 'the cancel committed');
    expectEqual(mocks.order().status, 'cancelled', 'cancelled');
    expectEqual(mocks.order().needsAttention, true, 'flagged');
    expectEqual(
      mocks.tables.OperationalAlert.rows.filter((row) => row.alertType === 'refund_failed').length,
      1,
      'refund_failed alert'
    );
  } finally {
    mocks.restore();
  }
});
