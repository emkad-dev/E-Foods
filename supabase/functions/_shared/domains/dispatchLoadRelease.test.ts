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
//
// Review round 4 extended this file rather than adding another: the round-4
// finding (dispatchAssignOrderCourier's manual reassignment had no
// compare-and-swap and leaked the incoming rider's load permanently when it
// raced a terminal transition) is a defect in the SAME ledger, and the
// invariant under test is one invariant - "for each (order, courier) claim,
// exactly one decrement ever lands" - across all four handlers that touch
// it. The harness therefore grew per-rider load tracking, mirrors of all
// three ledger SQL functions, and two interleaving hooks that let a second
// handler commit mid-flight of the first, deterministically.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./dispatch.ts');
const { partnerDomain } = await import('./partner.ts');
const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');
const originalDispatchLoadReleaseFrom = serviceClient.from.bind(serviceClient);
const originalDispatchLoadReleaseRpc = serviceClient.rpc.bind(serviceClient);
const originalDispatchLoadReleaseFetch = globalThis.fetch;

const dispatchUpdateOrderStatus = dispatchDomain.handlers.dispatchUpdateOrderStatus;
if (typeof dispatchUpdateOrderStatus !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchUpdateOrderStatus is not registered.');
}

const dispatchAssignOrderCourier = dispatchDomain.handlers.dispatchAssignOrderCourier;
if (typeof dispatchAssignOrderCourier !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchAssignOrderCourier is not registered.');
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

const CUSTOMER_CONTEXT = {
  email: 'customer@example.test',
  role: 'customer',
  token: 'fake-token',
  uid: 'customer-release-1',
  userProfile: { uid: 'customer-release-1', email: 'customer@example.test', role: 'customer', accountDisabled: false },
};

const ORDER_ID = 'order-release-1';
const RESTAURANT_ID = 'restaurant-release-1';
const RIDER_ID = 'rider-release-1';
const RIDER_B_ID = 'rider-release-2';
const CUSTOMER_ID = 'customer-release-1';

type Row = Record<string, unknown>;

type TableHooks = {
  /** Fires (once) inside an async read, before the rows are returned. */
  beforeRead?: () => Promise<void>;
  /** Fires (once) inside an awaited update, BEFORE the payload is applied. */
  beforeUpdate?: () => Promise<void>;
};

// A minimal in-memory postgrest-shaped table: .eq/.in/.is actually filter,
// .order/.limit actually apply, .maybeSingle/.single unwrap to one row (or
// null), and plainly awaiting the builder (no terminal call) resolves to
// the filtered array - matching however each call site in the real
// handlers happens to chain, without hand-coding every combination.
//
// Updates apply when the builder is awaited, not when .eq() is called
// (postgrest's own semantics, and what makes beforeUpdate a usable
// interleaving point: a hook can commit another handler's whole transaction
// in the window between "this handler decided to write" and "the write
// landed").
const createTable = (initialRows: Row[], hooks: TableHooks = {}) => {
  const rows: Row[] = [...initialRows];

  // Reads return COPIES, the way a real round trip does. This is not a
  // detail: every bug in rounds 1-4 lives in the gap between "what the
  // handler read" and "what is committed now", and a mock that hands back
  // live row references closes that gap for free - the handler's `bundle`
  // would silently update itself when an interleaved handler wrote, so a
  // stale-snapshot check like assertNonTerminalOrder would appear to catch
  // races it cannot actually see in production. Verified by mutation: with
  // live references, reverting the compare-and-swap left the round-4
  // ordering-1 test green, because the pre-flight guard was reading
  // post-write state.
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
      async maybeSingle() {
        if (hooks.beforeRead) await hooks.beforeRead();
        return { data: filtered[0] ? snapshot(filtered[0]) : null, error: null };
      },
      async single() {
        if (hooks.beforeRead) await hooks.beforeRead();
        return { data: filtered[0] ? snapshot(filtered[0]) : null, error: null };
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
    update(payload: Row) {
      const filters: Array<[string, unknown]> = [];
      // Returns the rows this update actually touched, so the compare-and-swap
      // write (updateOrderRecordIfStatus: `.eq('id').eq('status', expected)
      // .select('id')`) can read `.length` to learn whether its status guard
      // matched. Filters are honoured, so a `.eq('status', 'placed')` write
      // against a row a hook has since flipped to 'cancelled' matches nothing.
      const apply = async () => {
        if (hooks.beforeUpdate) await hooks.beforeUpdate();
        const updated: Row[] = [];
        for (const row of rows) {
          if (filters.every(([col, val]) => row[col] === val)) {
            Object.assign(row, payload);
            updated.push(row);
          }
        }
        return updated;
      };
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        select(_columns?: string) {
          return apply().then((updated) => ({ data: updated.map((row) => ({ ...row })), error: null }));
        },
        then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          return apply().then(() => ({ error: null })).then(resolve, reject);
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

const buildAssignmentRow = (courierId: string | null): Row => ({
  assignedAt: new Date().toISOString(),
  courierId,
  courierName: courierId ? 'Ada Rider' : null,
  dispatchId: null,
  dispatchOwnerId: courierId,
  loadReleasedAt: null,
  orderId: ORDER_ID,
  updatedAt: new Date().toISOString(),
});

const buildRiderRow = (id: string, displayName: string): Row => ({
  activeLoad: 0, // the ledger of record for these tests is state.load, not this column: every production write to activeLoad goes through ebuy_adjust_dispatch_rider_load, which the rpc mock below models.
  displayName,
  id,
  latitude: null,
  longitude: null,
  status: 'Available',
  vehicleType: 'bike',
});

// Mirrors normalizeOrderStatus (_shared/orders.ts) - and, more to the point,
// ebuy_lock_order_status, which the two compare-and-swap SQL functions use
// to decide whether a write is still allowed.
const normalizeStatus = (value: unknown) => {
  const status = typeof value === 'string' && value.trim() ? value.trim() : 'draft';
  if (status === 'pending' || status === 'confirmed') return 'placed';
  if (status === 'ready') return 'ready_for_pickup';
  return status;
};

const ASSIGNABLE_STATUSES = ['accepted', 'preparing', 'ready_for_pickup'];

type MockOptions = {
  /** Courier on the assignment row at request start. `null` = row exists, unclaimed. */
  assignmentCourierId?: string | null;
  /** Runs once, inside dispatchAssignOrderCourier's DispatchRiderRecord lookup. */
  onCourierLookup?: () => Promise<void>;
  /** Runs once, inside a CustomerOrder update, before the new status is applied. */
  beforeOrderUpdate?: () => Promise<void>;
};

/**
 * Installs a table mock per referenced table plus a strict rpc mock
 * implementing the three ledger functions - claim, reassign, release -
 * each mirroring its SQL guard:
 *
 *   * release: `loadReleasedAt is null`, and (round 4) keyed on the ORDER
 *     alone, decrementing whichever courier the row currently names. The
 *     mock rejects a p_courier_id argument outright, because passing one is
 *     what let a release silently no-op against a legitimately reassigned
 *     row.
 *   * reassign: the order's committed status must still be in
 *     ASSIGNABLE_STATUSES and the claim must not already be released;
 *     otherwise nothing is written and nothing is adjusted.
 *   * claim: same status guard, plus `courierId is null`.
 *
 * Any OTHER rpc name - in particular ebuy_adjust_dispatch_rider_load, what
 * a bare adjustDispatchRiderLoad call would use - throws. That is what
 * makes these tests mutation-provable: reverting a handler to a bare
 * decrement/increment either throws through the handler or leaves the
 * counter untouched, and every test asserts the exact counter, not just
 * that the call did not blow up (both call sites wrap the release in
 * try/catch, so a thrown error alone is invisible).
 *
 * state.load deliberately does NOT clamp at zero the way the production
 * `greatest(0, ...)` does: an over-decrement must show up as a negative
 * number rather than being silently absorbed - that absorption is exactly
 * what hid round 4's double decrement of the outgoing rider.
 */
const installHandlerMocks = (orderStatus: string, startingRiderLoad: number, options: MockOptions = {}) => {
  const state = {
    load: {
      [RIDER_ID]: startingRiderLoad,
      [RIDER_B_ID]: 0,
    } as Record<string, number>,
    rpcCalls: [] as Array<{ fn: string; params: Record<string, unknown> }>,
  };

  let courierLookupHookFired = false;
  let orderUpdateHookFired = false;

  const assignmentCourierId =
    options.assignmentCourierId === undefined ? RIDER_ID : options.assignmentCourierId;

  const tables = {
    CustomerOrder: createTable([buildOrderRow(orderStatus)], {
      beforeUpdate: options.beforeOrderUpdate
        ? async () => {
          // Fire-once: the interleaved handler writes to CustomerOrder too,
          // and an unguarded hook would recurse forever.
          if (orderUpdateHookFired) return;
          orderUpdateHookFired = true;
          await options.beforeOrderUpdate!();
        }
        : undefined,
    }),
    DeliveryAssignment: createTable([buildAssignmentRow(assignmentCourierId)]),
    DeliveryEvent: createTable([]),
    DispatchRiderRecord: createTable(
      [buildRiderRow(RIDER_ID, 'Ada Rider'), buildRiderRow(RIDER_B_ID, 'Bode Rider')],
      {
        beforeRead: options.onCourierLookup
          ? async () => {
            if (courierLookupHookFired) return;
            courierLookupHookFired = true;
            await options.onCourierLookup!();
          }
          : undefined,
      }
    ),
    OrderItem: createTable([]),
    RestaurantApproval: createTable([]),
    RestaurantRecord: createTable([{ id: RESTAURANT_ID, ownerId: null }]),
    UserAccount: createTable([]), // no row for ADMIN_CONTEXT.uid -> loadUserAccount returns null -> loadManagedRestaurantForUser falls back to the RestaurantRecord query below, and every push-token lookup returns no rows (push sending is skipped, not something these tests assert on).
    UserRole: createTable([]), // no restaurant-role links -> notifyRestaurantUsers falls back to RestaurantRecord.ownerId.
  };

  const assignmentRow = () => tables.DeliveryAssignment.rows.find((row) => row.orderId === ORDER_ID) ?? null;
  const orderStatusNow = () => {
    const order = tables.CustomerOrder.rows.find((row) => row.id === ORDER_ID);
    return order ? normalizeStatus(order.status) : null;
  };
  const adjustLoad = (courierId: string, delta: number) => {
    state.load[courierId] = (state.load[courierId] ?? 0) + delta;
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

    if (fn === 'ebuy_release_dispatch_assignment_load') {
      if ('p_courier_id' in params) {
        throw new Error(
          'dispatchLoadRelease.test.ts: the release is keyed on the order alone - a caller-supplied courier id is the stale read round 4 removed'
        );
      }
      const assignment = assignmentRow();
      const courierId = typeof assignment?.courierId === 'string' ? assignment.courierId : '';
      if (!assignment || !courierId || assignment.loadReleasedAt) {
        return { data: [{ released: false }], error: null };
      }
      assignment.loadReleasedAt = new Date().toISOString();
      adjustLoad(courierId, -1);
      return { data: [{ released: true }], error: null };
    }

    if (fn === 'ebuy_reassign_dispatch_assignment_courier') {
      const status = orderStatusNow();
      const assignment = assignmentRow();
      const previousCourierId = typeof assignment?.courierId === 'string' ? assignment.courierId : null;

      if (!status || !ASSIGNABLE_STATUSES.includes(status)) {
        return { data: [{ orderStatus: status, previousCourierId: null, reassigned: false }], error: null };
      }
      if (assignment?.loadReleasedAt) {
        return { data: [{ orderStatus: status, previousCourierId, reassigned: false }], error: null };
      }

      const nextCourierId = params.p_courier_id as string;
      const patch = {
        assignedAt: new Date().toISOString(),
        courierId: nextCourierId,
        courierName: params.p_courier_name,
        dispatchId: params.p_dispatch_id,
        dispatchOwnerId: nextCourierId,
        loadReleasedAt: null,
        orderId: params.p_order_id,
        updatedAt: new Date().toISOString(),
      };
      if (assignment) {
        Object.assign(assignment, patch);
      } else {
        tables.DeliveryAssignment.rows.push({ ...patch, createdAt: new Date().toISOString() });
      }

      if (previousCourierId !== nextCourierId) {
        if (previousCourierId) {
          adjustLoad(previousCourierId, -1);
        }
        adjustLoad(nextCourierId, 1);
      }

      return { data: [{ orderStatus: status, previousCourierId, reassigned: true }], error: null };
    }

    if (fn === 'ebuy_claim_dispatch_assignment') {
      const status = orderStatusNow();
      if (!status || !ASSIGNABLE_STATUSES.includes(status)) {
        return { data: [{ claimed: false }], error: null };
      }
      const assignment = assignmentRow();
      if (assignment?.courierId) {
        return { data: [{ claimed: false }], error: null };
      }
      const nextCourierId = params.p_courier_id as string;
      const patch = {
        assignedAt: new Date().toISOString(),
        courierId: nextCourierId,
        courierName: params.p_courier_name,
        dispatchOwnerId: params.p_dispatch_owner_id,
        loadReleasedAt: null,
        orderId: params.p_order_id,
        updatedAt: new Date().toISOString(),
      };
      if (assignment) {
        Object.assign(assignment, patch);
      } else {
        tables.DeliveryAssignment.rows.push({ ...patch, createdAt: new Date().toISOString() });
      }
      adjustLoad(nextCourierId, 1);
      return { data: [{ claimed: true }], error: null };
    }

    throw new Error(
      `dispatchLoadRelease.test.ts: unexpected rpc "${fn}" - every activeLoad write must go through a guarded ledger function, not adjustDispatchRiderLoad's own rpc`
    );
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/realtime/v1/api/broadcast')) {
      return new Response('{}', { status: 200 });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  return { ...state, assignmentRow, tables };
};

/** Runs a handler expected to reject, returning the RpcError-ish status. */
const expectHandlerFailure = async (run: () => Promise<unknown>, label: string) => {
  try {
    await run();
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (typeof status !== 'number') {
      throw new Error(`${label}: expected an RpcError with a status, got ${String(error)}`);
    }
    return status;
  }
  throw new Error(`${label}: expected the handler to fail, but it returned successfully`);
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
  expectEqual(state.load[RIDER_ID], 2, 'activeLoad decremented exactly once via the guarded release');
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
  expectEqual(state.load[RIDER_ID], 4, 'a failed delivery releases capacity exactly the same as a successful one');
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
  expectEqual(state.load[RIDER_ID], 2, 'the self-delivery flow (restaurant marks delivered) still releases the auto-assigned rider');
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
  expectEqual(state.load[RIDER_ID], 0, 'rejecting an order that was already auto-assigned releases the rider');
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
  expectEqual(state.load[RIDER_ID], 3, 'cancelling an order that was already auto-assigned releases the rider');
});

// ---------------------------------------------------------------------------
// Review round 4: dispatchAssignOrderCourier's manual reassignment.
//
// The handler's every precondition - assertNonTerminalOrder, the
// ACCEPTED/PREPARING/READY_FOR_PICKUP gate, the ownership check - reads a
// bundle loaded once at the top of the request, and none of its writes used
// to be conditioned on the order's committed state. Racing a terminal
// transition therefore leaked the incoming rider's load PERMANENTLY, in
// both orderings, because a terminal order is never transitioned again and
// so nothing ever releases the claim. The three tests below drive both
// orderings and the happy path through the real handlers, with the
// interleaved handler committing mid-flight of the first one.
// ---------------------------------------------------------------------------

Deno.test('dispatchAssignOrderCourier: a live A->B reassignment moves the claim, and the later terminal release follows the ROW to B', async () => {
  const state = installHandlerMocks('accepted', 2);

  const assigned = await dispatchAssignOrderCourier({
    context: ADMIN_CONTEXT,
    data: { courierId: RIDER_B_ID, orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(assigned.status, 200, 'the reassignment succeeds on a live order');
  expectEqual(state.load[RIDER_ID], 1, 'the outgoing rider is decremented exactly once');
  expectEqual(state.load[RIDER_B_ID], 1, 'the incoming rider is incremented exactly once');
  expectEqual(state.assignmentRow()?.courierId, RIDER_B_ID, 'the row now names the incoming rider');
  expectEqual(state.assignmentRow()?.loadReleasedAt, null, "the incoming rider's claim is live");

  // The terminal transition that follows must release B, not A - it reads
  // the row, and the row is the authority on who holds the claim.
  const cancelled = await cancelCustomerOrder({
    context: CUSTOMER_CONTEXT,
    data: { orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(cancelled.status, 200, 'the cancel succeeds');
  expectEqual(state.load[RIDER_B_ID], 0, "the incoming rider's claim is released exactly once");
  expectEqual(state.load[RIDER_ID], 1, 'the outgoing rider is not decremented a second time');
});

// Ordering 1: the terminal transition commits FIRST, and the reassignment
// carries on against its stale snapshot.
//
// Pre-fix: the unconditional upsert wrote courierId=B and cleared
// loadReleasedAt back to null (making a cancelled order look live), then
// decremented A a second time (production's greatest(0,...) clamp absorbs
// it silently; this mock does not clamp, so it shows) and incremented B on
// an order that will never transition again - B up by one forever.
Deno.test('dispatchAssignOrderCourier: a reassignment racing a cancel that commits first is refused, and does not strand the incoming rider', async () => {
  let cancelStatus = 0;
  const state = installHandlerMocks('accepted', 1, {
    // Fires inside the handler's DispatchRiderRecord lookup - after it has
    // loaded (and validated) its order bundle, before it writes anything.
    onCourierLookup: async () => {
      const cancelled = await cancelCustomerOrder({
        context: CUSTOMER_CONTEXT,
        data: { orderId: ORDER_ID },
        request: fakeRequest(),
      });
      cancelStatus = cancelled.status;
    },
  });

  const status = await expectHandlerFailure(
    () =>
      dispatchAssignOrderCourier({
        context: ADMIN_CONTEXT,
        data: { courierId: RIDER_B_ID, orderId: ORDER_ID },
        request: fakeRequest(),
      }),
    'reassignment onto an order that went terminal mid-flight'
  );

  expectEqual(cancelStatus, 200, 'the interleaved cancel committed');
  expectEqual(status, 412, 'the reassignment fails the precondition at write time, exactly as it would have at read time');
  expectEqual(state.load[RIDER_ID], 0, "the outgoing rider's claim is released exactly once - not decremented again by the refused reassignment");
  expectEqual(state.load[RIDER_B_ID], 0, 'the incoming rider is never incremented, so nothing is stranded on a terminal order');
  expectEqual(state.assignmentRow()?.courierId, RIDER_ID, 'the refused reassignment wrote nothing');
  expectEqual(
    typeof state.assignmentRow()?.loadReleasedAt,
    'string',
    'the release marker is intact - the refused reassignment did not clear it back to null'
  );
});

// Ordering 2: the reassignment commits FIRST, and the terminal transition
// carries on against ITS stale snapshot (its in-memory bundle still names
// A).
//
// Pre-fix: the release was keyed on the caller's courier id, so
// `where "courierId" = A` matched zero rows once the row said B - a silent
// no-op, leaving B up by one forever. Now the release names no courier at
// all and decrements whoever the row holds.
Deno.test('dispatchAssignOrderCourier: a reassignment committing mid-delivery-transition still leaves exactly one decrement per claim', async () => {
  let reassignStatus = 0;
  const state = installHandlerMocks('ready_for_pickup', 1, {
    // Fires inside partnerUpdateOrderStatus's own status write, after that
    // handler loaded its bundle (courier A) and before 'delivered' lands -
    // so the partner handler runs the rest of its work, including the
    // release, believing the courier is still A.
    beforeOrderUpdate: async () => {
      const reassigned = await dispatchAssignOrderCourier({
        context: ADMIN_CONTEXT,
        data: { courierId: RIDER_B_ID, orderId: ORDER_ID },
        request: fakeRequest(),
      });
      reassignStatus = reassigned.status;
    },
  });

  const response = await partnerUpdateOrderStatus({
    context: ADMIN_CONTEXT,
    data: { action: 'delivered', orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(reassignStatus, 200, 'the interleaved reassignment committed while the order was still live');
  expectEqual(response.status, 200, 'the delivery transition succeeds');
  expectEqual(state.load[RIDER_ID], 0, "the outgoing rider's claim is decremented exactly once, by the reassignment");
  expectEqual(state.load[RIDER_B_ID], 0, "the incoming rider's claim is decremented exactly once, by the stale terminal release");
  expectEqual(state.assignmentRow()?.courierId, RIDER_B_ID, 'the row still names the rider who actually carried the order');
});

// The same stale-snapshot shape on the release side alone: an order that
// had NO courier when the terminal handler read its bundle can be claimed
// by automatic assignment moments later. The old `if (courierId)` pre-check
// skipped the release on that basis and stranded the claim; the release is
// now called unconditionally and is a no-op only when the ROW has no live
// claim.
Deno.test('partnerUpdateOrderStatus: a claim landing mid-transition is still released, even though the handler read an unassigned order', async () => {
  const state = installHandlerMocks('ready_for_pickup', 0, {
    assignmentCourierId: null,
    beforeOrderUpdate: async () => {
      // What runAutomaticDispatchAssignment does at the end of a concurrent
      // transition on this same order: the guarded claim, nothing else.
      // deno-lint-ignore no-explicit-any
      await (serviceClient as any).rpc('ebuy_claim_dispatch_assignment', {
        p_courier_id: RIDER_B_ID,
        p_courier_name: 'Bode Rider',
        p_dispatch_owner_id: RIDER_B_ID,
        p_order_id: ORDER_ID,
      });
    },
  });

  const response = await partnerUpdateOrderStatus({
    context: ADMIN_CONTEXT,
    data: { action: 'delivered', orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'the delivery transition succeeds');
  expectEqual(state.load[RIDER_B_ID], 0, 'the courier claimed mid-transition is released, not stranded');
  expectEqual(
    typeof state.assignmentRow()?.loadReleasedAt,
    'string',
    'the claim is marked released'
  );
});

// ---------------------------------------------------------------------------
// Task 14 (E3) review-fix: partnerUpdateOrderStatus's accept is a stale-
// snapshot write racing the acceptance-deadline sweep's cancel-and-refund.
//
// partnerUpdateOrderStatus reads its order bundle with a plain
// loadOrderBundle (no FOR UPDATE), validates "only placed can be accepted"
// against that T0 snapshot, and USED to write status/payment unconditionally
// with `.eq('id')`. So: T0 partner reads `placed` -> T1 the sweep commits
// `cancelled` + `payment.status='refunded'` + refundAmount + notifies the
// customer "fully refunded" -> T2 the partner's unconditional write overwrites
// `status='accepted'` with the stale T0 PAID payment. Order live in the
// kitchen, payment shows paid, customer already refunded: real money lost.
//
// The fix makes the accept a compare-and-swap on the status it observed
// (updateOrderRecordIfStatus: `.eq('status', <observed>)`), failing 409 when
// zero rows match. This test drives that interleaving through the REAL handler:
// the interleaved cancel+refund commits inside the accept's own write window
// (beforeOrderUpdate, BEFORE the payload is applied), exactly the T1->T2 gap.
Deno.test('partnerUpdateOrderStatus: an accept racing the sweep\'s cancel+refund is refused and never resurrects the order', async () => {
  // deno-lint-ignore prefer-const
  let mocks: ReturnType<typeof installHandlerMocks>;
  mocks = installHandlerMocks('placed', 0, {
    // The acceptance sweep's ebuy_auto_cancel_unaccepted_order committing in
    // the window between the partner handler's bundle read and its write:
    // cancelled + fully refunded.
    beforeOrderUpdate: async () => {
      const order = mocks.tables.CustomerOrder.rows.find((row) => row.id === ORDER_ID);
      if (order) {
        order.status = 'cancelled';
        order.payment = {
          capturedAmount: 5000,
          method: 'card',
          refundAmount: 5000,
          refundedAt: new Date().toISOString(),
          status: 'refunded',
        };
        order.cancellation = { actor: 'system', reason: 'acceptance_deadline', refundRate: 1 };
      }
    },
  });

  const status = await expectHandlerFailure(
    () =>
      partnerUpdateOrderStatus({
        context: ADMIN_CONTEXT,
        data: { action: 'accept', orderId: ORDER_ID },
        request: fakeRequest(),
      }),
    'accept onto an order the sweep cancelled mid-flight',
  );

  expectEqual(status, 409, 'the accept fails the write-time status guard, not silently succeeds');

  const order = mocks.tables.CustomerOrder.rows.find((row) => row.id === ORDER_ID);
  expectEqual(order?.status, 'cancelled', 'the order stays cancelled - the accept wrote nothing');
  const payment = order?.payment as Record<string, unknown>;
  expectEqual(payment.status, 'refunded', 'the refund is intact - not overwritten with the stale paid payment');
  expectEqual(payment.refundAmount, 5000, 'the refund amount is intact');
});

Deno.test('dispatchLoadRelease cleanup: restore shared client and fetch', () => {
  // Keep later files on the real client and fetch implementation.
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalDispatchLoadReleaseFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalDispatchLoadReleaseRpc;
  globalThis.fetch = originalDispatchLoadReleaseFetch;
});
