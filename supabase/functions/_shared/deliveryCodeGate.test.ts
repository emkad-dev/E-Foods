// Handler-level tests for SP-2 proof of delivery: dispatchUpdateOrderStatus
// must require the customer's 4-digit handoff code on the `delivered`
// transition (admins override, audited), lock out after too many wrong codes,
// and stamp deliveryCodeVerifiedAt on the same status write.
//
// Drives the REAL handler out of the REAL dispatch domain map. Assertions are
// on stored rows (status, attempts counter, verified stamp, events), never on
// "a function was called".
//
// Runs in the --no-check `deno test` invocation (domain modules carry
// pre-existing `deno check` errors tracked in scripts/deno-check-baseline.txt).

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./domains/dispatch.ts');
const { serviceClient } = await import('./client.ts');

const dispatchUpdateOrderStatus = dispatchDomain.handlers.dispatchUpdateOrderStatus;
if (typeof dispatchUpdateOrderStatus !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchUpdateOrderStatus is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const ORDER_ID = 'order-code-gate-1';
const RESTAURANT_ID = 'restaurant-code-gate-1';
const RIDER_ID = 'rider-code-gate-1';
const ADMIN_ID = 'admin-code-gate-1';

const contextFor = (uid: string, role: 'dispatch' | 'admin') => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

type Row = Record<string, unknown>;

const createTable = (initialRows: Row[]) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));
  const copy = (row: Row) => ({ ...row });

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
      limit() {
        return builder;
      },
      returns() {
        return Promise.resolve({ data: filtered.map(copy), error: null });
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
    select: (_columns?: string) => select(),
    async insert(payload: Row) {
      rows.push({ ...payload });
      return { error: null };
    },
    update(payload: Row) {
      const filters: Array<[string, unknown]> = [];
      const matching = () => rows.filter((row) => filters.every(([col, val]) => row[col] === val));
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        select(_columns?: string) {
          const matched = matching();
          for (const row of matched) Object.assign(row, payload);
          return Promise.resolve({ data: matched.map((row) => ({ id: row.id })), error: null });
        },
        then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          for (const row of matching()) Object.assign(row, payload);
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
};

const originalFrom = serviceClient.from.bind(serviceClient);
const originalRpc = serviceClient.rpc.bind(serviceClient);
const originalFetch = globalThis.fetch;

const installMocks = (opts: { attempts?: number; racerBumpsAttempts?: boolean } = {}) => {
  const tables = {
    CustomerOrder: createTable([
      {
        createdAt: new Date().toISOString(),
        customerId: 'customer-code-gate-1',
        deliveryCode: '1234',
        deliveryCodeAttempts: opts.attempts ?? 0,
        deliveryCodeVerifiedAt: null,
        deliveryLocation: null,
        fulfillmentType: 'delivery',
        id: ORDER_ID,
        payment: { method: 'card', status: 'paid' },
        pricing: { total: 5000 },
        restaurantId: RESTAURANT_ID,
        restaurantName: 'Test Kitchen',
        status: 'on_the_way',
        timeline: {},
        updatedAt: new Date().toISOString(),
      },
    ]),
    DeliveryAssignment: createTable([
      {
        assignedAt: new Date().toISOString(),
        courierId: RIDER_ID,
        courierName: 'Ada Rider',
        dispatchId: null,
        dispatchOwnerId: RIDER_ID,
        loadReleasedAt: null,
        orderId: ORDER_ID,
      },
    ]),
    DeliveryEvent: createTable([]),
    FeatureFlag: createTable([
      { description: null, enabled: true, key: 'platform_dispatch', updatedAt: new Date().toISOString() },
    ]),
    OrderItem: createTable([]),
    RestaurantApproval: createTable([]),
    RestaurantRecord: createTable([{ id: RESTAURANT_ID, ownerId: null }]),
    UserAccount: createTable([]),
    UserRole: createTable([]),
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const mock = (tables as Record<string, ReturnType<typeof createTable>>)[table];
    if (!mock) throw new Error(`deliveryCodeGate.test.ts: unexpected table "${table}"`);
    return mock;
  };
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string) => {
    if (fn === 'ebuy_release_dispatch_assignment_load') {
      return { data: [{ released: true }], error: null };
    }
    throw new Error(`deliveryCodeGate.test.ts: unexpected rpc "${fn}"`);
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/realtime/v1/api/broadcast')) return new Response('{}', { status: 200 });
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  const order = () => tables.CustomerOrder.rows[0];

  // Simulates a concurrent request taking the attempt slot between this
  // handler's snapshot read and its compare-and-swap reservation.
  if (opts.racerBumpsAttempts) {
    const realUpdate = tables.CustomerOrder.update.bind(tables.CustomerOrder);
    let bumped = false;
    tables.CustomerOrder.update = (payload: Row) => {
      if (!bumped && 'deliveryCodeAttempts' in payload) {
        bumped = true;
        order().deliveryCodeAttempts = (order().deliveryCodeAttempts as number) + 1;
      }
      return realUpdate(payload);
    };
  }

  return { events: () => tables.DeliveryEvent.rows, order };
};

const restoreMocks = () => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalRpc;
  globalThis.fetch = originalFetch;
};

const deliver = (role: 'dispatch' | 'admin', deliveryCode?: unknown) =>
  dispatchUpdateOrderStatus({
    context: contextFor(role === 'admin' ? ADMIN_ID : RIDER_ID, role),
    data: { action: 'delivered', orderId: ORDER_ID, ...(deliveryCode === undefined ? {} : { deliveryCode }) },
    request: fakeRequest(),
  });

const expectFailure = async (run: () => Promise<unknown>, expectedStatus: number, label: string) => {
  try {
    await run();
  } catch (error) {
    expectEqual((error as { status?: number }).status, expectedStatus, `${label}: status`);
    return;
  }
  throw new Error(`${label}: expected the handler to fail with ${expectedStatus}, but it succeeded`);
};

Deno.test('delivered without a deliveryCode: 400, order untouched, attempt counted', async () => {
  const state = installMocks();
  try {
    await expectFailure(() => deliver('dispatch'), 400, 'missing code');
    expectEqual(state.order().status, 'on_the_way', 'status unchanged');
    expectEqual(state.order().deliveryCodeAttempts, 1, 'attempt incremented');
    expectEqual(state.order().deliveryCodeVerifiedAt, null, 'not verified');
  } finally {
    restoreMocks();
  }
});

Deno.test('delivered with a wrong deliveryCode: 400, order untouched, attempt counted', async () => {
  const state = installMocks();
  try {
    await expectFailure(() => deliver('dispatch', '9999'), 400, 'wrong code');
    expectEqual(state.order().status, 'on_the_way', 'status unchanged');
    expectEqual(state.order().deliveryCodeAttempts, 1, 'attempt incremented');
    expectEqual(state.order().deliveryCodeVerifiedAt, null, 'not verified');
  } finally {
    restoreMocks();
  }
});

Deno.test('delivered with the correct deliveryCode: transitions and stamps deliveryCodeVerifiedAt', async () => {
  const state = installMocks();
  try {
    const response = await deliver('dispatch', '1234');
    expectEqual(response.status, 200, 'handler succeeds');
    expectEqual(state.order().status, 'delivered', 'order delivered');
    expectEqual(typeof state.order().deliveryCodeVerifiedAt, 'string', 'verified stamp set');
    expectEqual(state.order().deliveryCodeAttempts, 1, 'the slot was reserved before the compare');
    expectEqual(
      state.events().some((event) => event.eventType === 'delivery_code_overridden'),
      false,
      'no override event for a rider'
    );
  } finally {
    restoreMocks();
  }
});

Deno.test('delivered once attempts are exhausted: 429, even with the right code', async () => {
  const state = installMocks({ attempts: 5 });
  try {
    await expectFailure(() => deliver('dispatch', '1234'), 429, 'locked out');
    expectEqual(state.order().status, 'on_the_way', 'status unchanged');
    expectEqual(state.order().deliveryCodeAttempts, 5, 'counter not advanced past the cap');
  } finally {
    restoreMocks();
  }
});

Deno.test('delivered by an admin with no code: succeeds and records delivery_code_overridden', async () => {
  const state = installMocks({ attempts: 5 });
  try {
    const response = await deliver('admin');
    expectEqual(response.status, 200, 'handler succeeds');
    expectEqual(state.order().status, 'delivered', 'order delivered');
    expectEqual(state.order().deliveryCodeVerifiedAt, null, 'admin override is not a verification');
    const override = state.events().find((event) => event.eventType === 'delivery_code_overridden');
    expectEqual(override?.actorUid, ADMIN_ID, 'override event carries the admin uid');
    expectEqual(override?.orderId, ORDER_ID, 'override event carries the order id');
  } finally {
    restoreMocks();
  }
});

Deno.test('lost attempt-slot race: the guess is never evaluated (even a correct code gets 400)', async () => {
  const state = installMocks({ racerBumpsAttempts: true });
  try {
    await expectFailure(() => deliver('dispatch', '1234'), 400, 'lost race');
    expectEqual(state.order().status, 'on_the_way', 'a guess that lost the slot cannot deliver');
    expectEqual(state.order().deliveryCodeVerifiedAt, null, 'not verified');
    expectEqual(state.order().deliveryCodeAttempts, 1, 'only the racing request increment landed');
  } finally {
    restoreMocks();
  }
});

Deno.test('lost attempt-slot race that trips the lock reports 429', async () => {
  const state = installMocks({ attempts: 4, racerBumpsAttempts: true });
  try {
    await expectFailure(() => deliver('dispatch', '9999'), 429, 'lost race at the cap');
    expectEqual(state.order().deliveryCodeAttempts, 5, 'counter stays at the cap');
    expectEqual(state.order().status, 'on_the_way', 'status unchanged');
  } finally {
    restoreMocks();
  }
});

Deno.test('4th to 5th boundary: the 5th wrong guess gets 400 and locks; the next guess gets 429', async () => {
  const state = installMocks({ attempts: 4 });
  try {
    await expectFailure(() => deliver('dispatch', '9999'), 400, '5th wrong guess');
    expectEqual(state.order().deliveryCodeAttempts, 5, 'attempts now at the cap');
    await expectFailure(() => deliver('dispatch', '1234'), 429, 'guess after lock');
    expectEqual(state.order().deliveryCodeAttempts, 5, 'counter not advanced past the cap');
    expectEqual(state.order().status, 'on_the_way', 'status unchanged');
  } finally {
    restoreMocks();
  }
});
