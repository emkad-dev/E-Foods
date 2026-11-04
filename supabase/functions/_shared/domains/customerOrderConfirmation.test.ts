// Handler-level tests for customer order confirmation.
//
// Drives the REAL handlers out of the REAL ordersDomain map
// (customerConfirmOrderReceived / customerReportOrderProblem), behind a
// `typeof !== 'function'` guard like orderRatings.test.ts, so a broken wiring
// cannot hide behind a test that only calls a helper. Assertions are on stored
// rows, the realtime broadcasts and the Expo push requests that actually left
// the process - never on "a function was called".
//
// The compare-and-swap is the thing under test, so the table mock honours
// `.eq` / `.is` filters on update and reports how many rows matched, and a
// `beforeUpdate` hook lets a "racing" request commit between the handler's
// read and its write.
//
// Runs in package.json's --no-check `deno test` invocation (the domain modules
// carry pre-existing `deno check` errors tracked in scripts/deno-check-baseline.txt).

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');

const customerConfirmOrderReceived = ordersDomain.handlers.customerConfirmOrderReceived;
if (typeof customerConfirmOrderReceived !== 'function') {
  throw new Error('ordersDomain.handlers.customerConfirmOrderReceived is not registered.');
}
const customerReportOrderProblem = ordersDomain.handlers.customerReportOrderProblem;
if (typeof customerReportOrderProblem !== 'function') {
  throw new Error('ordersDomain.handlers.customerReportOrderProblem is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const expectFailure = async (run: () => Promise<unknown>, expectedStatus: number, label: string) => {
  try {
    await run();
  } catch (error) {
    expectEqual((error as { status?: number }).status, expectedStatus, `${label}: status`);
    return;
  }
  throw new Error(`${label}: expected the handler to fail with ${expectedStatus}, but it succeeded`);
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const CUSTOMER_ID = 'customer-confirm-1';
const OTHER_CUSTOMER_ID = 'customer-confirm-2';
const RESTAURANT_ID = 'restaurant-confirm-1';
const RESTAURANT_USER_ID = 'restaurant-user-confirm-1';
const ADMIN_USER_ID = 'admin-confirm-1';
const ORDER_ID = 'order-confirm-ab12cd';
const DUE_AT = '2026-11-04T12:00:00.000Z';

const contextFor = (uid: string, role = 'customer') => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

type Row = Record<string, unknown>;

type TableHooks = {
  /** Fires once, inside an awaited update, BEFORE the payload is applied. */
  beforeUpdate?: () => void;
};

const createTable = (initialRows: Row[], hooks: TableHooks = {}) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));
  const copy = (row: Row) => ({ ...row });
  let nextId = 1;
  let hookFired = false;
  const updates: Row[] = [];

  const select = () => {
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
      is(col: string, val: unknown) {
        filtered = filtered.filter((row) => (row[col] ?? null) === val);
        return builder;
      },
      order() {
        return builder;
      },
      async maybeSingle() {
        return { data: filtered[0] ? copy(filtered[0]) : null, error: null };
      },
      async single() {
        return { data: filtered[0] ? copy(filtered[0]) : null, error: null };
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve({ data: filtered.map(copy), error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    rows,
    updates,
    select: (_columns?: string) => select(),
    insert(payload: Row) {
      const row = { id: `generated-${nextId++}`, createdAt: new Date().toISOString(), ...payload };
      rows.push(row);
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        single: async () => ({ data: copy(row), error: null }),
        then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    update(payload: Row) {
      const filters: Array<[string, unknown]> = [];
      const apply = () => {
        if (hooks.beforeUpdate && !hookFired) {
          hookFired = true;
          hooks.beforeUpdate();
        }
        const matched = rows.filter((row) => filters.every(([col, val]) => (row[col] ?? null) === val));
        for (const row of matched) Object.assign(row, payload);
        if (matched.length > 0) updates.push({ ...payload });
        return matched;
      };
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        is(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        select(_columns?: string) {
          const matched = apply();
          // deno-lint-ignore no-explicit-any
          const result: any = Promise.resolve({ data: matched.map(copy), error: null });
          result.single = async () => ({ data: matched[0] ? copy(matched[0]) : null, error: null });
          return result;
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

const buildOrderRow = (overrides: Row = {}): Row => ({
  createdAt: '2026-11-04T08:00:00.000Z',
  customerConfirmDueAt: DUE_AT,
  customerConfirmedAt: null,
  customerConfirmationSource: null,
  customerConfirmRemindersSent: 0,
  customerIssueReportedAt: null,
  customerId: CUSTOMER_ID,
  deliveryAddress: '1 Test Street',
  deliveryLocation: null,
  fulfillmentType: 'delivery',
  id: ORDER_ID,
  needsAttention: false,
  payment: { method: 'card', status: 'paid' },
  pricing: { total: 5000 },
  restaurantId: RESTAURANT_ID,
  restaurantName: 'Test Kitchen',
  status: 'delivered',
  timeline: {},
  updatedAt: '2026-11-04T09:00:00.000Z',
  ...overrides,
});

const originalFrom = serviceClient.from.bind(serviceClient);
const originalRpc = serviceClient.rpc.bind(serviceClient);
const originalFetch = globalThis.fetch;

type MockOptions = {
  order?: Row;
  conversations?: Row[];
  /** Runs once inside the CustomerOrder update, before the payload is applied. */
  beforeOrderUpdate?: (order: () => Row) => void;
};

const installMocks = (options: MockOptions = {}) => {
  const tables = {
    CustomerOrder: createTable([options.order ?? buildOrderRow()], {
      beforeUpdate: options.beforeOrderUpdate ? () => options.beforeOrderUpdate!(() => tables.CustomerOrder.rows[0]) : undefined,
    }),
    DeliveryAssignment: createTable([]),
    DeliveryEvent: createTable([]),
    OrderItem: createTable([]),
    PushDevice: createTable([
      { app: 'partner', token: 'ExponentPushToken[restaurant-device]', userId: RESTAURANT_USER_ID },
      { app: 'admin', token: 'ExponentPushToken[admin-device]', userId: ADMIN_USER_ID },
    ]),
    queue_notifications: createTable([]),
    RestaurantRecord: createTable([{ id: RESTAURANT_ID, ownerId: RESTAURANT_USER_ID }]),
    SupportConversation: createTable(options.conversations ?? []),
    SupportMessage: createTable([]),
    UserAccount: createTable([]),
    UserRole: createTable([
      { restaurantId: RESTAURANT_ID, role: 'restaurant', userId: RESTAURANT_USER_ID },
      { restaurantId: null, role: 'admin', userId: ADMIN_USER_ID },
    ]),
  };

  const broadcasts: string[] = [];
  const pushes: Array<{ to: string; title: string; body: string; data: Record<string, unknown> }> = [];

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const mock = (tables as Record<string, ReturnType<typeof createTable>>)[table];
    if (!mock) throw new Error(`customerOrderConfirmation.test.ts: unexpected table "${table}"`);
    return mock;
  };
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string) => {
    // The admin-alert email dedupe brake; the rest of the push pipeline is best-effort.
    if (fn === 'auth_rl_hit') return { data: [{ allowed: true }], error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/realtime/v1/api/broadcast')) {
      broadcasts.push(String(init?.body ?? ''));
      return new Response('{}', { status: 200 });
    }
    if (url.includes('exp.host/--/api/v2/push/send')) {
      const messages = JSON.parse(String(init?.body ?? '[]')) as typeof pushes;
      pushes.push(...messages);
      return new Response(JSON.stringify({ data: messages.map((_, index) => ({ id: `ticket-${pushes.length + index}`, status: 'ok' })) }), { status: 200 });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  return {
    broadcasts,
    messages: () => tables.SupportMessage.rows,
    conversations: () => tables.SupportConversation.rows,
    order: () => tables.CustomerOrder.rows[0],
    orderWrites: () => tables.CustomerOrder.updates,
    pushes,
    pushesTo: (token: string) => pushes.filter((push) => push.to === token),
  };
};

const restoreMocks = () => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalRpc;
  globalThis.fetch = originalFetch;
};

const confirm = (uid = CUSTOMER_ID, role = 'customer', data: Row = { orderId: ORDER_ID }) =>
  customerConfirmOrderReceived({ context: contextFor(uid, role), data, request: fakeRequest() });

const report = (message: unknown, uid = CUSTOMER_ID) =>
  customerReportOrderProblem({
    context: contextFor(uid),
    data: { message, orderId: ORDER_ID },
    request: fakeRequest(),
  });

const bodyOf = async (response: Response) => (await response.json()).data as Record<string, unknown>;

const withMocks = (options: MockOptions, run: (state: ReturnType<typeof installMocks>) => Promise<void>) =>
  async () => {
    const state = installMocks(options);
    try {
      await run(state);
    } finally {
      restoreMocks();
    }
  };

// ---------------------------------------------------------------------------
// customerConfirmOrderReceived
// ---------------------------------------------------------------------------

Deno.test(
  'confirm: another customer is refused (403) and nothing is written',
  withMocks({}, async (state) => {
    await expectFailure(() => confirm(OTHER_CUSTOMER_ID), 403, 'not the owner');
    expectEqual(state.order().customerConfirmedAt, null, 'not confirmed');
    expectEqual(state.orderWrites().length, 0, 'no write');
    expectEqual(state.pushes.length, 0, 'no push');
  })
);

Deno.test(
  'confirm: an admin cannot confirm on the customer behalf (owner-only)',
  withMocks({}, async (state) => {
    await expectFailure(() => confirm('admin-1', 'admin'), 403, 'admin role');
    expectEqual(state.orderWrites().length, 0, 'no write');
  })
);

Deno.test(
  'confirm: missing order id is 400, unknown order is 404',
  withMocks({}, async () => {
    await expectFailure(() => confirm(CUSTOMER_ID, 'customer', {}), 400, 'no id');
    await expectFailure(() => confirm(CUSTOMER_ID, 'customer', { orderId: 'nope' }), 404, 'unknown order');
  })
);

Deno.test(
  'confirm: an order that is not delivered yet is refused (412)',
  withMocks({ order: buildOrderRow({ status: 'ready_for_pickup', customerConfirmDueAt: null }) }, async (state) => {
    await expectFailure(() => confirm(), 412, 'not delivered');
    expectEqual(state.orderWrites().length, 0, 'no write');
  })
);

Deno.test(
  'confirm: a delivered order outside the flow (rider delivery code, no deadline) is refused (412)',
  withMocks({ order: buildOrderRow({ customerConfirmDueAt: null }) }, async (state) => {
    await expectFailure(() => confirm(), 412, 'not in flow');
    expectEqual(state.orderWrites().length, 0, 'no write');
  })
);

Deno.test(
  'confirm: records the confirmation, keeps status delivered, broadcasts, and tells the restaurant',
  withMocks({}, async (state) => {
    const response = await confirm();
    expectEqual(response.status, 200, 'handler succeeds');
    const body = await bodyOf(response);
    expectEqual(body.orderId, ORDER_ID, 'orderId');
    expectEqual(body.customerConfirmationSource, 'customer', 'response source');

    expectEqual(state.order().status, 'delivered', 'status is untouched');
    expectEqual(typeof state.order().customerConfirmedAt, 'string', 'confirmedAt stamped');
    expectEqual(state.order().customerConfirmationSource, 'customer', 'source stored');
    expectEqual(state.order().customerConfirmDueAt, DUE_AT, 'deadline is left as it was');
    expectEqual(state.broadcasts.length > 0, true, 'order-changed broadcast sent');

    const restaurantPushes = state.pushesTo('ExponentPushToken[restaurant-device]');
    expectEqual(restaurantPushes.length, 1, 'restaurant told once');
    expectEqual(restaurantPushes[0].data.routeKey, 'partner_order_detail', 'routes to the partner order');
    expectEqual(restaurantPushes[0].data.type, 'order_update', 'an order-update push');
    expectEqual(restaurantPushes[0].body.includes('AB12CD'), true, 'short order number in the copy');
    expectEqual(restaurantPushes[0].body.includes('received'), true, 'delivery wording');
  })
);

Deno.test(
  'confirm: pickup orders say collected',
  withMocks({ order: buildOrderRow({ fulfillmentType: 'pickup' }) }, async (state) => {
    await confirm();
    const pushes = state.pushesTo('ExponentPushToken[restaurant-device]');
    expectEqual(pushes.length, 1, 'restaurant told');
    expectEqual(pushes[0].body.includes('collected'), true, 'pickup wording');
  })
);

Deno.test(
  'confirm: already confirmed returns success with no second write and no second push',
  withMocks({}, async (state) => {
    await confirm();
    const firstConfirmedAt = state.order().customerConfirmedAt;
    const writesAfterFirst = state.orderWrites().length;
    const pushesAfterFirst = state.pushes.length;
    const broadcastsAfterFirst = state.broadcasts.length;

    const second = await confirm();
    expectEqual(second.status, 200, 'retry succeeds');
    expectEqual((await bodyOf(second)).customerConfirmedAt, firstConfirmedAt, 'reports the original stamp');
    expectEqual(state.order().customerConfirmedAt, firstConfirmedAt, 'stamp unchanged');
    expectEqual(state.orderWrites().length, writesAfterFirst, 'no second write');
    expectEqual(state.pushes.length, pushesAfterFirst, 'no second push');
    expectEqual(state.broadcasts.length, broadcastsAfterFirst, 'no second broadcast');
  })
);

Deno.test(
  'confirm: an order the auto-close already closed returns success and keeps source auto',
  withMocks(
    { order: buildOrderRow({ customerConfirmedAt: '2026-11-04T12:00:01.000Z', customerConfirmationSource: 'auto' }) },
    async (state) => {
      const response = await confirm();
      expectEqual(response.status, 200, 'success');
      expectEqual((await bodyOf(response)).customerConfirmationSource, 'auto', 'source reported as auto');
      expectEqual(state.order().customerConfirmationSource, 'auto', 'source not overwritten');
      expectEqual(state.orderWrites().length, 0, 'no write');
      expectEqual(state.pushes.length, 0, 'no push');
    }
  )
);

Deno.test(
  'confirm: losing the compare-and-swap to a concurrent confirmation writes nothing and notifies nobody',
  withMocks(
    {
      // The auto-close commits between this handler's read and its write.
      beforeOrderUpdate: (order) => {
        Object.assign(order(), { customerConfirmedAt: '2026-11-04T12:00:01.000Z', customerConfirmationSource: 'auto' });
      },
    },
    async (state) => {
      const response = await confirm();
      expectEqual(response.status, 200, 'the goal (order closed) is met, so success');
      expectEqual(state.order().customerConfirmationSource, 'auto', 'the winner is not overwritten');
      expectEqual(state.orderWrites().length, 0, 'the losing write matched nothing');
      expectEqual(state.pushes.length, 0, 'no push from the loser');
    }
  )
);

Deno.test(
  'confirm: still allowed after the customer reported a problem',
  withMocks({ order: buildOrderRow({ customerIssueReportedAt: '2026-11-04T10:00:00.000Z' }) }, async (state) => {
    const response = await confirm();
    expectEqual(response.status, 200, 'success');
    expectEqual(state.order().customerConfirmationSource, 'customer', 'confirmed');
    expectEqual(state.order().customerIssueReportedAt, '2026-11-04T10:00:00.000Z', 'report left intact');
  })
);

// ---------------------------------------------------------------------------
// customerReportOrderProblem
// ---------------------------------------------------------------------------

Deno.test(
  'report: a message is required, trimmed, and capped at 500 characters',
  withMocks({}, async (state) => {
    await expectFailure(() => report(undefined), 400, 'missing');
    await expectFailure(() => report('   \n  '), 400, 'blank');
    await expectFailure(() => report(42), 400, 'not a string');
    await expectFailure(() => report('x'.repeat(501)), 400, 'too long');
    expectEqual(state.orderWrites().length, 0, 'nothing written for rejected input');
    expectEqual(state.messages().length, 0, 'nothing posted for rejected input');

    const response = await report('x'.repeat(500));
    expectEqual(response.status, 200, 'exactly 500 is accepted');
  })
);

Deno.test(
  'report: control characters are stripped from what is stored and posted',
  withMocks({}, async (state) => {
    await report('Missing\u0000 rice\u0007\nand no spoon');
    expectEqual(state.messages()[0].body, 'Order AB12CD: Missing rice\nand no spoon', 'cleaned body');
  })
);

Deno.test(
  'report: another customer is refused (403) and nothing is written',
  withMocks({}, async (state) => {
    await expectFailure(() => report('It never came', OTHER_CUSTOMER_ID), 403, 'not the owner');
    expectEqual(state.orderWrites().length, 0, 'no write');
    expectEqual(state.messages().length, 0, 'no support message');
  })
);

Deno.test(
  'report: unknown order is 404',
  withMocks({}, async () => {
    await expectFailure(
      () =>
        customerReportOrderProblem({
          context: contextFor(CUSTOMER_ID),
          data: { message: 'x', orderId: 'nope' },
          request: fakeRequest(),
        }),
      404,
      'unknown order'
    );
  })
);

Deno.test(
  'report: refused (412) when not delivered, outside the flow, or already confirmed',
  async () => {
    for (const [label, order] of [
      ['not delivered', buildOrderRow({ status: 'on_the_way', customerConfirmDueAt: null })],
      ['outside the flow', buildOrderRow({ customerConfirmDueAt: null })],
      ['already confirmed', buildOrderRow({ customerConfirmedAt: '2026-11-04T10:00:00.000Z', customerConfirmationSource: 'customer' })],
    ] as const) {
      const state = installMocks({ order });
      try {
        await expectFailure(() => report('Something is wrong'), 412, label);
        expectEqual(state.orderWrites().length, 0, `${label}: no write`);
        expectEqual(state.messages().length, 0, `${label}: no support message`);
        expectEqual(state.pushes.length, 0, `${label}: no alert`);
      } finally {
        restoreMocks();
      }
    }
  }
);

Deno.test(
  'report: flags the order, keeps it delivered, posts to support with the order number, alerts admins',
  withMocks({}, async (state) => {
    const response = await report('  The jollof was cold and the drink was missing.  ');
    expectEqual(response.status, 200, 'handler succeeds');

    expectEqual(state.order().status, 'delivered', 'status untouched');
    expectEqual(typeof state.order().customerIssueReportedAt, 'string', 'report stamped');
    expectEqual(state.order().needsAttention, true, 'flagged for FEASTY');
    expectEqual(state.order().customerConfirmedAt, null, 'not confirmed by reporting');
    expectEqual(state.order().customerConfirmDueAt, DUE_AT, 'deadline retained (the sweep skips reported orders)');
    expectEqual(state.broadcasts.length > 0, true, 'order-changed broadcast sent');

    expectEqual(state.conversations().length, 1, 'a support thread was created for the customer');
    expectEqual(state.conversations()[0].customerId, CUSTOMER_ID, 'thread belongs to the customer');
    expectEqual(state.messages().length, 1, 'one message');
    expectEqual(state.messages()[0].senderType, 'customer', 'sent as the customer');
    expectEqual(state.messages()[0].senderId, CUSTOMER_ID, 'sender is the customer');
    expectEqual(
      state.messages()[0].body,
      'Order AB12CD: The jollof was cold and the drink was missing.',
      'prefixed with the short order number'
    );

    const adminPushes = state.pushesTo('ExponentPushToken[admin-device]');
    expectEqual(adminPushes.length, 1, 'admins alerted once');
    expectEqual(adminPushes[0].body.includes('AB12CD'), true, 'alert names the order');
    expectEqual(adminPushes[0].body.includes('jollof was cold'), true, 'alert carries the text');
    expectEqual(state.pushesTo('ExponentPushToken[restaurant-device]').length, 0, 'the restaurant is not pushed');
  })
);

Deno.test(
  'report: reuses the customer existing support thread and reopens it if closed',
  withMocks(
    {
      conversations: [
        { id: 'conv-1', customerId: CUSTOMER_ID, status: 'closed', subject: 'Earlier', lastMessageAt: 'x', updatedAt: 'x' },
      ],
    },
    async (state) => {
      await report('Wrong order delivered');
      expectEqual(state.conversations().length, 1, 'no second thread');
      expectEqual(state.conversations()[0].status, 'open', 'reopened');
      expectEqual(state.messages()[0].conversationId, 'conv-1', 'posted to the existing thread');
    }
  )
);

Deno.test(
  'report: a repeat report returns success and duplicates nothing',
  withMocks({}, async (state) => {
    const first = await report('First report');
    const firstStamp = (await bodyOf(first)).customerIssueReportedAt;
    const writes = state.orderWrites().length;
    const pushes = state.pushes.length;

    const second = await report('Second report, different text');
    expectEqual(second.status, 200, 'repeat succeeds');
    expectEqual((await bodyOf(second)).customerIssueReportedAt, firstStamp, 'original stamp reported');
    expectEqual(state.order().customerIssueReportedAt, firstStamp, 'stamp unchanged');
    expectEqual(state.orderWrites().length, writes, 'no second order write');
    expectEqual(state.messages().length, 1, 'no second support message');
    expectEqual(state.pushes.length, pushes, 'no second admin alert');
  })
);

Deno.test(
  'report: losing the compare-and-swap to a concurrent report posts nothing (once, under a race)',
  withMocks(
    {
      beforeOrderUpdate: (order) => {
        Object.assign(order(), { customerIssueReportedAt: '2026-11-04T10:00:00.000Z', needsAttention: true });
      },
    },
    async (state) => {
      const response = await report('Raced report');
      expectEqual(response.status, 200, 'success');
      expectEqual(state.order().customerIssueReportedAt, '2026-11-04T10:00:00.000Z', 'the winner stamp stays');
      expectEqual(state.messages().length, 0, 'the loser posts no message');
      expectEqual(state.pushes.length, 0, 'the loser raises no alert');
    }
  )
);

Deno.test(
  'report: a confirmation that lands first closes the door on a late report (412)',
  withMocks(
    {
      beforeOrderUpdate: (order) => {
        Object.assign(order(), { customerConfirmedAt: '2026-11-04T10:00:00.000Z', customerConfirmationSource: 'customer' });
      },
    },
    async (state) => {
      await expectFailure(() => report('Too late'), 412, 'confirmed first');
      expectEqual(state.order().customerIssueReportedAt, null, 'not flagged');
      expectEqual(state.messages().length, 0, 'nothing posted');
    }
  )
);

Deno.test(
  'report then confirm: the customer can still close the order afterwards',
  withMocks({}, async (state) => {
    await report('Missing item');
    const response = await confirm();
    expectEqual(response.status, 200, 'confirm succeeds after a report');
    expectEqual(state.order().customerConfirmationSource, 'customer', 'confirmed');
    expectEqual(state.order().needsAttention, true, 'still flagged for FEASTY');
  })
);
