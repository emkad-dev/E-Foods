// Tests for the review round 3 finding: round 2's regression test
// (dispatchSelection.test.ts) called releaseDispatchAssignmentLoad
// directly and never exercised dispatch.ts or partner.ts at all - a
// mutation check (revert dispatchUpdateOrderStatus's release call back to
// the bare adjustDispatchRiderLoad(-1) it used to make) left the full suite
// green, because the shared helper was correctly tested but the *wiring*
// from each handler to it was not. This file drives the REAL handlers out
// of the REAL domain maps - dispatchDomain.handlers.dispatchUpdateOrderStatus
// and partnerDomain.handlers.partnerUpdateOrderStatus - the same way
// adminSetRestaurantPublished.test.ts does, and for the same reason: the
// domain modules statically import _shared/client.ts, which throws at
// module scope without SUPABASE_URL / SERVICE_ROLE_KEY set first, so the
// two env vars are set here, then the domain modules are imported
// dynamically. Runs in package.json's second, --no-check `deno test`
// invocation (the domain modules carry pre-existing `deno check` type
// errors, tracked separately in scripts/deno-check-baseline.txt).
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./dispatch.ts');
const { partnerDomain } = await import('./partner.ts');
const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');

const dispatchUpdateOrderStatus = dispatchDomain.handlers.dispatchUpdateOrderStatus;
if (typeof dispatchUpdateOrderStatus !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchUpdateOrderStatus is not registered.');
}

const partnerUpdateOrderStatus = partnerDomain.handlers.partnerUpdateOrderStatus;
if (typeof partnerUpdateOrderStatus !== 'function') {
  throw new Error('partnerDomain.handlers.partnerUpdateOrderStatus is not registered.');
}

const cancelCustomerOrder = ordersDomain.handlers.cancelCustomerOrder;
if (typeof cancelCustomerOrder !== 'function') {
  throw new Error('ordersDomain.handlers.cancelCustomerOrder is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const ADMIN_CONTEXT = {
  email: 'admin@example.test',
  role: 'admin',
  token: 'fake-token',
  uid: 'admin-uid-no-account-row',
  userProfile: { uid: 'admin-uid-no-account-row', email: 'admin@example.test', role: 'admin', accountDisabled: false },
};

const ORDER_ID = 'order-release-1';
const RESTAURANT_ID = 'restaurant-release-1';
const RIDER_ID = 'rider-release-1';
const CUSTOMER_ID = 'customer-release-1';

type Row = Record<string, unknown>;

// A minimal in-memory postgrest-shaped table: .eq/.in/.is actually filter,
// .order/.limit actually apply, .maybeSingle/.single unwrap to one row (or
// null), and plainly awaiting the builder (no terminal call) resolves to
// the filtered array - matching however each call site in the real
// handlers happens to chain, without hand-coding every combination.
const createTable = (initialRows: Row[]) => {
  const rows: Row[] = [...initialRows];

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
      async maybeSingle() {
        return { data: filtered[0] ?? null, error: null };
      },
      async single() {
        return { data: filtered[0] ?? null, error: null };
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
        return Promise.resolve({ data: result, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    rows,
    select(_columns?: string) {
      return query();
    },
    update(payload: Row) {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          for (const row of rows) {
            if (row[col] === val) Object.assign(row, payload);
          }
          return builder;
        },
        then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async insert(payload: Row) {
      rows.push({ ...payload });
      return { error: null };
    },
    upsert(payload: Row, opts?: { onConflict?: string }) {
      const key = opts?.onConflict ?? 'id';
      const idx = rows.findIndex((row) => row[key] === payload[key]);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...payload };
      } else {
        rows.push({ ...payload });
      }
      return Promise.resolve({ error: null });
    },
  };
};

const buildOrderRow = (status: string): Row => ({
  cancellation: null,
  createdAt: new Date().toISOString(),
  customerId: CUSTOMER_ID,
  deliveryAddress: '1 Test Street',
  deliveryLocation: null,
  fulfillmentType: 'delivery',
  id: ORDER_ID,
  payment: { method: 'cash', status: 'pending' },
  pricing: { total: 5000 },
  restaurantId: RESTAURANT_ID,
  restaurantName: 'Test Kitchen',
  status,
  timeline: {},
  updatedAt: new Date().toISOString(),
});

const buildAssignmentRow = (): Row => ({
  assignedAt: new Date().toISOString(),
  courierId: RIDER_ID,
  courierName: 'Ada Rider',
  dispatchId: null,
  dispatchOwnerId: RIDER_ID,
  loadReleasedAt: null,
  orderId: ORDER_ID,
  updatedAt: new Date().toISOString(),
});

/**
 * Installs a table mock per referenced table plus a strict rpc mock that
 * only recognises ebuy_release_dispatch_assignment_load - mirroring the
 * real ebuy_release_dispatch_assignment_load's `loadReleasedAt is null`
 * guard by mutating the DeliveryAssignment table directly, so a claim can
 * only ever be released once. Any OTHER rpc name (in particular
 * ebuy_adjust_dispatch_rider_load, what the bare adjustDispatchRiderLoad(-1)
 * this fix replaced would call instead) throws - which is what makes this
 * mutation-provable: if a future edit reverts a handler back to the bare
 * decrement, this mock throws inside the release call, the handler's own
 * try/catch swallows it (matching the non-fatal contract), and riderLoad
 * simply never decrements - so the test's assertion on the final counter
 * value goes red, exactly the signal round 2's helper-only test failed to
 * produce.
 */
const installHandlerMocks = (orderStatus: string, startingRiderLoad: number) => {
  const state = {
    riderLoad: startingRiderLoad,
    rpcCalls: [] as Array<{ fn: string; params: Record<string, unknown> }>,
  };

  const tables = {
    CustomerOrder: createTable([buildOrderRow(orderStatus)]),
    DeliveryAssignment: createTable([buildAssignmentRow()]),
    DeliveryEvent: createTable([]),
    OrderItem: createTable([]),
    RestaurantApproval: createTable([]),
    RestaurantRecord: createTable([{ id: RESTAURANT_ID, ownerId: null }]),
    UserAccount: createTable([]), // no row for ADMIN_CONTEXT.uid -> loadUserAccount returns null -> loadManagedRestaurantForUser falls back to the RestaurantRecord query below, and every push-token lookup returns no rows (push sending is skipped, not something these tests assert on).
    UserRole: createTable([]), // no restaurant-role links -> notifyRestaurantUsers falls back to RestaurantRecord.ownerId.
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const mock = (tables as Record<string, ReturnType<typeof createTable>>)[table];
    if (!mock) {
      throw new Error(`dispatchLoadRelease.test.ts: unexpected table "${table}"`);
    }
    return mock;
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, params });

    if (fn !== 'ebuy_release_dispatch_assignment_load') {
      throw new Error(`dispatchLoadRelease.test.ts: unexpected rpc "${fn}" - the handler must call the guarded release, not adjustDispatchRiderLoad's own rpc`);
    }

    const assignment = tables.DeliveryAssignment.rows.find(
      (row) => row.orderId === params.p_order_id && row.courierId === params.p_courier_id
    );
    if (!assignment || assignment.loadReleasedAt) {
      return { data: [{ released: false }], error: null };
    }

    assignment.loadReleasedAt = new Date().toISOString();
    state.riderLoad -= 1;
    return { data: [{ released: true }], error: null };
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

Deno.test('dispatchUpdateOrderStatus: marking delivered releases the assigned rider through releaseDispatchAssignmentLoad', async () => {
  const state = installHandlerMocks('picked_up', 3);

  const response = await dispatchUpdateOrderStatus({
    context: ADMIN_CONTEXT,
    data: { action: 'delivered', orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'handler succeeds');
  expectEqual(
    state.rpcCalls.some((call) => call.fn === 'ebuy_release_dispatch_assignment_load'),
    true,
    'the release rpc was called'
  );
  expectEqual(state.riderLoad, 2, 'activeLoad decremented exactly once via the guarded release');
});

Deno.test('dispatchUpdateOrderStatus: marking failed_delivery releases the assigned rider through releaseDispatchAssignmentLoad', async () => {
  const state = installHandlerMocks('on_the_way', 5);

  const response = await dispatchUpdateOrderStatus({
    context: ADMIN_CONTEXT,
    data: { action: 'failed_delivery', orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'handler succeeds');
  expectEqual(
    state.rpcCalls.some((call) => call.fn === 'ebuy_release_dispatch_assignment_load'),
    true,
    'the release rpc was called'
  );
  expectEqual(state.riderLoad, 4, 'a failed delivery releases capacity exactly the same as a successful one');
});

Deno.test('partnerUpdateOrderStatus: marking delivered releases the assigned rider through releaseDispatchAssignmentLoad', async () => {
  const state = installHandlerMocks('ready_for_pickup', 3);

  const response = await partnerUpdateOrderStatus({
    context: ADMIN_CONTEXT,
    data: { action: 'delivered', orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'handler succeeds');
  expectEqual(
    state.rpcCalls.some((call) => call.fn === 'ebuy_release_dispatch_assignment_load'),
    true,
    'the release rpc was called'
  );
  expectEqual(state.riderLoad, 2, 'the self-delivery flow (restaurant marks delivered) still releases the auto-assigned rider');
});

Deno.test('partnerUpdateOrderStatus: rejecting an accepted order releases the assigned rider through releaseDispatchAssignmentLoad', async () => {
  const state = installHandlerMocks('accepted', 1);

  const response = await partnerUpdateOrderStatus({
    context: ADMIN_CONTEXT,
    data: { action: 'reject', orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'handler succeeds');
  expectEqual(
    state.rpcCalls.some((call) => call.fn === 'ebuy_release_dispatch_assignment_load'),
    true,
    'the release rpc was called'
  );
  expectEqual(state.riderLoad, 0, 'rejecting an order that was already auto-assigned releases the rider');
});

// cancelCustomerOrder (_shared/domains/orders.ts) is a third decrement
// pathway, not one of the two the round-2 fix considered: a courier is
// claimed the moment a restaurant accepts (ACCEPTED is in
// AUTO_DISPATCH_ELIGIBLE_STATUSES), and this handler permits cancellation
// from exactly [PLACED, ACCEPTED] - the same states partnerUpdateOrderStatus's
// `reject` permits - so a customer cancelling a just-accepted order needed
// the same guarded release as the other two paths (review round 3).
Deno.test('cancelCustomerOrder: cancelling an already-assigned accepted order releases the assigned rider through releaseDispatchAssignmentLoad', async () => {
  const state = installHandlerMocks('accepted', 4);

  const response = await cancelCustomerOrder({
    context: ADMIN_CONTEXT,
    data: { orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'handler succeeds');
  expectEqual(
    state.rpcCalls.some((call) => call.fn === 'ebuy_release_dispatch_assignment_load'),
    true,
    'the release rpc was called'
  );
  expectEqual(state.riderLoad, 3, 'cancelling an order that was already auto-assigned releases the rider');
});
