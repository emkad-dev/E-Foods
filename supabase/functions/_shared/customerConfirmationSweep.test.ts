// Tests for the customer-confirmation sweep. They drive the REAL
// sweepCustomerConfirmations against an in-memory postgrest mock and assert the
// STORED order rows plus the push messages that actually reached the (mocked)
// Expo endpoint, never merely "a function was called".
//
// The module statically imports _shared/client.ts, which throws at module scope
// without SUPABASE_URL / SERVICE_ROLE_KEY, so the env vars are set first and the
// module is imported dynamically (same bootstrap as acceptanceDeadlineSweep.test.ts).
// Runs in package.json's --no-check `deno test` invocation: the sweep
// transitively imports modules that carry pre-existing `deno check` errors.
//
// WHAT IS REAL VS MOCKED. The candidate filter, the stage decision, the
// claim-before-push ordering and the auto-close wiring are REAL TS. The mock's
// UPDATE honours the same .eq/.is guards the sweep sends, which is what makes
// the compare-and-swap tests meaningful: a hook mutates the live row AFTER the
// sweep read its snapshot and BEFORE the guarded write lands, exactly the window
// a second sweep, a confirm or a report would use.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { sweepCustomerConfirmations } = await import('./customerConfirmationSweep.ts');
if (typeof sweepCustomerConfirmations !== 'function') {
  throw new Error('sweepCustomerConfirmations is not exported as a function.');
}

const { serviceClient } = await import('./client.ts');

const MINUTE_MS = 60_000;
const CUSTOMER_ID = 'customer-confirm-1';
const PUSH_TOKEN = 'ExponentPushToken[customer-confirm-1]';

type Row = Record<string, unknown>;

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const expectIncludes = (actual: unknown, fragment: string, label: string) => {
  if (typeof actual !== 'string' || !actual.includes(fragment)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} to include ${JSON.stringify(fragment)}`);
  }
};

// 13:00 in Africa/Lagos (UTC+1): comfortably outside quiet hours.
const DAYTIME = new Date('2026-11-04T12:00:00.000Z');

type MockOptions = {
  /** Fires at the moment a guarded UPDATE is about to apply, with the live rows
   * and the targeted order id - the window between the sweep's read and write. */
  beforeUpdate?: (rows: Row[], orderId: unknown) => void;
  /** Make the candidate lookup fail. */
  failCandidateLookup?: boolean;
};

const createOrderTable = (initialRows: Row[], options: MockOptions) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));
  const snapshot = (row: Row) => ({ ...row });

  type Predicate = (row: Row) => boolean;
  const addFilters = (predicates: Predicate[]) => ({
    eq(col: string, val: unknown) {
      predicates.push((row) => row[col] === val);
    },
    in(col: string, vals: unknown[]) {
      predicates.push((row) => vals.includes(row[col]));
    },
    is(col: string, val: unknown) {
      predicates.push((row) => (row[col] ?? null) === val);
    },
    not(col: string, op: string, val: unknown) {
      if (op !== 'is') throw new Error(`mock supports only .not(col, 'is', v), got ${op}`);
      predicates.push((row) => (row[col] ?? null) !== val);
    },
  });

  return {
    rows,
    select(_columns?: string) {
      const predicates: Predicate[] = [];
      const filters = addFilters(predicates);
      let orderCol: string | null = null;
      let limitN: number | null = null;
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq: (c: string, v: unknown) => (filters.eq(c, v), builder),
        in: (c: string, v: unknown[]) => (filters.in(c, v), builder),
        is: (c: string, v: unknown) => (filters.is(c, v), builder),
        not: (c: string, o: string, v: unknown) => (filters.not(c, o, v), builder),
        order(col: string) {
          orderCol = col;
          return builder;
        },
        limit(n: number) {
          limitN = n;
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          if (options.failCandidateLookup) {
            return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
          }
          let result = rows.filter((row) => predicates.every((p) => p(row)));
          if (orderCol) {
            const col = orderCol;
            result = [...result].sort((a, b) => {
              const av = a[col] as string;
              const bv = b[col] as string;
              return av < bv ? -1 : av > bv ? 1 : 0;
            });
          }
          if (limitN !== null) result = result.slice(0, limitN);
          return Promise.resolve({ data: result.map(snapshot), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(payload: Row) {
      rows.push({ ...payload });
      return Promise.resolve({ error: null });
    },
    update(payload: Row) {
      const predicates: Predicate[] = [];
      const filters = addFilters(predicates);
      let orderId: unknown = null;
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq: (c: string, v: unknown) => {
          if (c === 'id') orderId = v;
          filters.eq(c, v);
          return builder;
        },
        is: (c: string, v: unknown) => (filters.is(c, v), builder),
        select: (_columns?: string) => builder,
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          try {
            options.beforeUpdate?.(rows, orderId);
            const matched = rows.filter((row) => predicates.every((p) => p(row)));
            for (const row of matched) Object.assign(row, payload);
            return Promise.resolve({ data: matched.map((row) => ({ id: row.id })), error: null }).then(
              resolve,
              reject
            );
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      };
      return builder;
    },
  };
};

const createPlainTable = (initialRows: Row[]) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));
  return {
    rows,
    select() {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        in: () => builder,
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null }).then(resolve, reject),
      };
      return builder;
    },
    insert(payload: Row) {
      rows.push({ ...payload });
      return Promise.resolve({ error: null });
    },
  };
};

type PushMessage = { body: string; data: Record<string, string>; title: string; to: string };

const completedMinutesAgo = (minutes: number, now: Date = DAYTIME) => ({
  // dueAt = completion + 3h; the sweep derives completion back from it.
  customerConfirmDueAt: new Date(now.getTime() - minutes * MINUTE_MS + 180 * MINUTE_MS).toISOString(),
});

const buildOrderRow = (overrides: Row): Row => ({
  customerConfirmedAt: null,
  customerConfirmRemindersSent: 0,
  customerConfirmationSource: null,
  customerConfirmDueAt: null,
  customerId: CUSTOMER_ID,
  customerIssueReportedAt: null,
  fulfillmentType: 'delivery',
  id: 'order-confirm-aaaaaa',
  restaurantId: 'restaurant-1',
  status: 'delivered',
  updatedAt: '2026-11-04T10:00:00.000Z',
  ...overrides,
});

const installMocks = (orders: Row[], options: MockOptions = {}) => {
  const tables = {
    CustomerOrder: createOrderTable(orders, options),
    PushDevice: createPlainTable([]),
    UserAccount: createPlainTable([{ expoPushToken: PUSH_TOKEN, uid: CUSTOMER_ID }]),
    queue_notifications: createPlainTable([]),
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const mock = tables[table as keyof typeof tables];
    if (!mock) {
      throw new Error(`customerConfirmationSweep.test.ts: unexpected table "${table}"`);
    }
    return mock;
  };

  const pushes: PushMessage[] = [];
  let broadcasts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('exp.host/--/api/v2/push/send')) {
      const messages = JSON.parse(String(init?.body)) as PushMessage[];
      pushes.push(...messages);
      return Promise.resolve(
        new Response(JSON.stringify({ data: messages.map((_, i) => ({ id: `ticket-${i}`, status: 'ok' })) }), {
          status: 200,
        })
      );
    }
    if (url.includes('/realtime/v1/api/broadcast')) {
      broadcasts += 1;
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;

  const restore = () => {
    globalThis.fetch = originalFetch;
  };

  return { broadcasts: () => broadcasts, order: (id?: string) => tables.CustomerOrder.rows.find((r) => !id || r.id === id)!, pushes, restore };
};

// ---------------------------------------------------------------------------
// Each stage sends once, with the right copy, and never again.
// ---------------------------------------------------------------------------
Deno.test('sweep: each reminder stage is sent exactly once, with stage-specific delivery wording', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-s1-aaaaaa', ...completedMinutesAgo(31) }),
    buildOrderRow({ id: 'order-s2-bbbbbb', ...completedMinutesAgo(95), customerConfirmRemindersSent: 1 }),
    buildOrderRow({ id: 'order-s3-cccccc', ...completedMinutesAgo(151), customerConfirmRemindersSent: 2 }),
  ]);
  try {
    const first = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(first.reminded, 3, 'one reminder per order');
    expectEqual(mocks.pushes.length, 3, 'three pushes reached Expo');
    expectEqual(mocks.order('order-s1-aaaaaa').customerConfirmRemindersSent, 1, 'stage 1 recorded');
    expectEqual(mocks.order('order-s2-bbbbbb').customerConfirmRemindersSent, 2, 'stage 2 recorded');
    expectEqual(mocks.order('order-s3-cccccc').customerConfirmRemindersSent, 3, 'stage 3 recorded');

    const byOrder = (id: string) => mocks.pushes.find((p) => p.data.orderId === id)!;
    expectIncludes(byOrder('order-s1-aaaaaa').body, 'received', 'stage 1 delivery wording');
    expectIncludes(byOrder('order-s2-bbbbbb').body, 'received', 'stage 2 delivery wording');
    expectIncludes(byOrder('order-s3-cccccc').body, 'received', 'stage 3 delivery wording');
    expectIncludes(byOrder('order-s3-cccccc').body, '30 minutes', 'stage 3 says it closes in 30 minutes');
    expectEqual(byOrder('order-s1-aaaaaa').body.includes('30 minutes'), false, 'stage 1 does not mention closing');
    expectEqual(byOrder('order-s1-aaaaaa').data.routeKey, 'customer_order_detail', 'routes to the customer order');
    expectEqual(byOrder('order-s1-aaaaaa').data.app, 'customer', 'targets the customer app');
    expectEqual(mocks.broadcasts(), 0, 'a reminder claim does not broadcast');

    const second = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(second.reminded, 0, 'a second sweep sends nothing');
    expectEqual(mocks.pushes.length, 3, 'no further pushes');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: pickup orders are told to confirm they collected, not received', async () => {
  const mocks = installMocks([
    buildOrderRow({ id: 'order-pick-aaaaaa', fulfillmentType: 'pickup', ...completedMinutesAgo(151), customerConfirmRemindersSent: 2 }),
    buildOrderRow({ id: 'order-pick-bbbbbb', fulfillmentType: 'pickup', ...completedMinutesAgo(31) }),
  ]);
  try {
    await sweepCustomerConfirmations(DAYTIME);
    for (const push of mocks.pushes) {
      expectIncludes(push.body, 'collected', 'pickup wording');
      expectEqual(push.body.includes('received'), false, 'pickup copy never says received');
    }
    expectEqual(mocks.pushes.length, 2, 'both pickup orders were reminded');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: nothing is sent before the first stage is due', async () => {
  const mocks = installMocks([buildOrderRow({ ...completedMinutesAgo(29) })]);
  try {
    const result = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(result.reminded, 0, 'no reminder yet');
    expectEqual(result.autoClosed, 0, 'not closed yet');
    expectEqual(mocks.pushes.length, 0, 'no push');
    expectEqual(mocks.order().customerConfirmRemindersSent, 0, 'counter untouched');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// Quiet hours: no push 22:00-07:00 Lagos; the first sweep after sends ONE.
// ---------------------------------------------------------------------------
Deno.test('sweep: quiet hours send nothing, and the first sweep after 07:00 sends only the latest due stage', async () => {
  // Completed 05:00 Lagos (04:00Z): stage 1 due 05:30, stage 2 due 06:30, stage 3 due 07:30.
  const completedAt = new Date('2026-11-04T04:00:00.000Z');
  const dueAt = new Date(completedAt.getTime() + 180 * MINUTE_MS).toISOString();
  const mocks = installMocks([buildOrderRow({ customerConfirmDueAt: dueAt })]);
  try {
    // 06:45 Lagos: stages 1 and 2 are due but it is quiet.
    const quiet = await sweepCustomerConfirmations(new Date('2026-11-04T05:45:00.000Z'));
    expectEqual(quiet.reminded, 0, 'nothing sent in quiet hours');
    expectEqual(mocks.pushes.length, 0, 'no push in quiet hours');
    expectEqual(mocks.order().customerConfirmRemindersSent, 0, 'quiet hours consume nothing');

    // 07:05 Lagos: both stage 1 and 2 are overdue; only stage 2 goes out.
    const morning = await sweepCustomerConfirmations(new Date('2026-11-04T06:05:00.000Z'));
    expectEqual(morning.reminded, 1, 'exactly one catch-up reminder');
    expectEqual(mocks.pushes.length, 1, 'exactly one push');
    expectEqual(mocks.order().customerConfirmRemindersSent, 2, 'stage 1 is consumed along with stage 2');

    const later = await sweepCustomerConfirmations(new Date('2026-11-04T06:06:00.000Z'));
    expectEqual(later.reminded, 0, 'the skipped stage is not sent afterwards');
    expectEqual(mocks.pushes.length, 1, 'still one push');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: an order due in quiet hours still auto-closes, silently', async () => {
  // Completed 00:30 Lagos; the 3 hours run out at 03:30 Lagos.
  const completedAt = new Date('2026-11-03T23:30:00.000Z');
  const dueAt = new Date(completedAt.getTime() + 180 * MINUTE_MS).toISOString();
  const mocks = installMocks([buildOrderRow({ customerConfirmDueAt: dueAt, customerConfirmRemindersSent: 3 })]);
  try {
    const result = await sweepCustomerConfirmations(new Date('2026-11-04T02:35:00.000Z'));
    expectEqual(result.autoClosed, 1, 'closed during quiet hours');
    expectEqual(mocks.pushes.length, 0, 'closed without a push');
    expectEqual(mocks.order().customerConfirmationSource, 'auto', 'source recorded as auto');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// Reported / confirmed orders are not candidates: the report "stops the timer".
// ---------------------------------------------------------------------------
Deno.test('sweep: reported and confirmed orders are never reminded or auto-closed', async () => {
  const mocks = installMocks([
    // Reported, reminder due.
    buildOrderRow({ id: 'order-rep-aaaaaa', ...completedMinutesAgo(95), customerIssueReportedAt: '2026-11-04T11:00:00.000Z' }),
    // Reported, window long past: must NOT close (the timer is stopped).
    buildOrderRow({ id: 'order-rep-bbbbbb', ...completedMinutesAgo(400), customerIssueReportedAt: '2026-11-04T07:00:00.000Z' }),
    // Confirmed, reminder due.
    buildOrderRow({ id: 'order-con-cccccc', ...completedMinutesAgo(95), customerConfirmedAt: '2026-11-04T11:00:00.000Z', customerConfirmationSource: 'customer' }),
  ]);
  try {
    const result = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(result.reminded, 0, 'no reminders');
    expectEqual(result.autoClosed, 0, 'nothing auto-closed');
    expectEqual(mocks.pushes.length, 0, 'no pushes');
    expectEqual(mocks.order('order-rep-bbbbbb').customerConfirmedAt, null, 'the reported order stays open');
    expectEqual(mocks.order('order-rep-aaaaaa').customerConfirmRemindersSent, 0, 'reported counter untouched');
    expectEqual(mocks.order('order-con-cccccc').customerConfirmationSource, 'customer', 'confirmed order untouched');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: orders outside the confirmation flow are ignored', async () => {
  const mocks = installMocks([
    // Rider order confirmed by delivery code: no deadline was ever set.
    buildOrderRow({ id: 'order-code-aaaaaa', customerConfirmDueAt: null }),
    buildOrderRow({ id: 'order-prep-bbbbbb', status: 'preparing', ...completedMinutesAgo(95) }),
  ]);
  try {
    const result = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(result.reminded + result.autoClosed, 0, 'nothing acted on');
    expectEqual(mocks.pushes.length, 0, 'no pushes');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// The compare-and-swap: a loser of the race must not push.
// ---------------------------------------------------------------------------
Deno.test('sweep: a reminder claim that loses the race to another sweep does not push', async () => {
  const mocks = installMocks([buildOrderRow({ ...completedMinutesAgo(31) })], {
    // A second, overlapping sweep claims stage 1 between our read and our write.
    beforeUpdate: (rows) => {
      rows[0].customerConfirmRemindersSent = 1;
    },
  });
  try {
    const result = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(result.reminded, 0, 'the loser sent nothing');
    expectEqual(result.skipped, 1, 'counted as skipped');
    expectEqual(mocks.pushes.length, 0, 'no push from the loser');
    expectEqual(mocks.order().customerConfirmRemindersSent, 1, "the winner's claim stands");
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: a customer report landing between the read and the claim suppresses the reminder', async () => {
  const mocks = installMocks([buildOrderRow({ ...completedMinutesAgo(31) })], {
    beforeUpdate: (rows) => {
      rows[0].customerIssueReportedAt = '2026-11-04T11:59:59.000Z';
    },
  });
  try {
    const result = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(result.reminded, 0, 'no reminder after a report');
    expectEqual(mocks.pushes.length, 0, 'no push');
    expectEqual(mocks.order().customerConfirmRemindersSent, 0, 'counter not claimed');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// Auto-close.
// ---------------------------------------------------------------------------
Deno.test('sweep: an order past its 3 hours closes automatically, stays delivered, broadcasts and sends no push', async () => {
  const mocks = installMocks([buildOrderRow({ ...completedMinutesAgo(181), customerConfirmRemindersSent: 3 })]);
  try {
    const result = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(result.autoClosed, 1, 'closed');
    const order = mocks.order();
    expectEqual(order.status, 'delivered', 'status stays delivered');
    expectEqual(order.customerConfirmationSource, 'auto', 'source auto');
    expectEqual(typeof order.customerConfirmedAt, 'string', 'confirmedAt stamped');
    expectEqual(mocks.pushes.length, 0, 'no push on close');
    expectEqual(mocks.broadcasts(), 1, 'open order screens are told the order changed');

    const again = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(again.autoClosed, 0, 'closing is idempotent');
    expectEqual(mocks.broadcasts(), 1, 'no second broadcast');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: an order exactly at its deadline closes instead of getting a reminder', async () => {
  const mocks = installMocks([buildOrderRow({ ...completedMinutesAgo(180) })]);
  try {
    const result = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(result.autoClosed, 1, 'closed');
    expectEqual(result.reminded, 0, 'not reminded');
    expectEqual(mocks.pushes.length, 0, 'no push');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: a customer confirming between the read and the close keeps their confirmation', async () => {
  const mocks = installMocks([buildOrderRow({ ...completedMinutesAgo(181) })], {
    beforeUpdate: (rows) => {
      rows[0].customerConfirmedAt = '2026-11-04T11:59:59.000Z';
      rows[0].customerConfirmationSource = 'customer';
    },
  });
  try {
    const result = await sweepCustomerConfirmations(DAYTIME);
    expectEqual(result.autoClosed, 0, 'the close lost the race');
    expectEqual(result.skipped, 1, 'counted as skipped');
    expectEqual(mocks.order().customerConfirmationSource, 'customer', "the customer's confirmation stands");
    expectEqual(mocks.broadcasts(), 0, 'no broadcast for a write that did not apply');
  } finally {
    mocks.restore();
  }
});

// ---------------------------------------------------------------------------
// Resilience.
// ---------------------------------------------------------------------------

// Expected-failure tests log through logEdgeEvent (console); keep the run output clean.
const withQuietLogs = async (work: () => Promise<void>) => {
  const original = { error: console.error, log: console.log, warn: console.warn };
  console.error = console.log = console.warn = () => {};
  try {
    await work();
  } finally {
    Object.assign(console, original);
  }
};
Deno.test('sweep: an order that throws does not stop the rest of the batch', async () => {
  const mocks = installMocks(
    [
      // Oldest due first, so the throwing order is processed before the good one.
      buildOrderRow({ id: 'order-bad-aaaaaa', ...completedMinutesAgo(100) }),
      buildOrderRow({ id: 'order-good-bbbbbb', ...completedMinutesAgo(31) }),
    ],
    {
      beforeUpdate: (_rows, orderId) => {
        if (orderId === 'order-bad-aaaaaa') throw new Error('simulated write failure');
      },
    }
  );
  try {
    let result!: Awaited<ReturnType<typeof sweepCustomerConfirmations>>;
    await withQuietLogs(async () => {
      result = await sweepCustomerConfirmations(DAYTIME);
    });
    expectEqual(result.reminded, 1, 'the good order was still reminded');
    expectEqual(result.skipped, 1, 'the bad order counted as skipped');
    expectEqual(mocks.pushes.length, 1, 'one push');
    expectEqual(mocks.pushes[0].data.orderId, 'order-good-bbbbbb', 'the push is for the good order');
    expectEqual(mocks.order('order-bad-aaaaaa').customerConfirmRemindersSent, 0, 'bad order not claimed');
  } finally {
    mocks.restore();
  }
});

Deno.test('sweep: a failed candidate lookup returns an empty result instead of throwing', async () => {
  const mocks = installMocks([buildOrderRow({ ...completedMinutesAgo(31) })], { failCandidateLookup: true });
  try {
    let result!: Awaited<ReturnType<typeof sweepCustomerConfirmations>>;
    await withQuietLogs(async () => {
      result = await sweepCustomerConfirmations(DAYTIME);
    });
    expectEqual(result.reminded + result.autoClosed + result.skipped, 0, 'nothing done');
    expectEqual(mocks.pushes.length, 0, 'no push');
  } finally {
    mocks.restore();
  }
});
