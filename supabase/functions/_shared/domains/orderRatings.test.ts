// Handler-level tests for Task 12 (E1) ratings.
//
// Drives the REAL handlers out of the REAL domain map -
// ordersDomain.handlers.customerSubmitOrderRating / customerGetPendingRatings
// - behind a `typeof !== 'function'` guard, the same way
// dispatchOfferResponse.test.ts and dispatchLoadRelease.test.ts do, for the
// same reason: a test that only calls a shared helper directly can pass with
// the handler's own wiring fully broken.
//
// The rpc mock mirrors ebuy_submit_order_rating (20260820_order_ratings.sql)
// precisely - ownership check, delivered-status check, the "already rated"
// outcome standing in for the real UNIQUE-constraint-driven unique_violation,
// and the atomic (avg*count+score)/(count+1) aggregate update - because that
// SQL function's own guards are the thing under test from the handler's side;
// a live Postgres constraint can't run inside `deno test`, so the mock's
// fidelity to the migration is the whole point (same tradeoff
// dispatchOfferResponse.test.ts makes for the offer-acceptance CAS).
//
// Every read returns a COPY (see `snapshot`) so a handler holding onto a
// "read" can never mutate the mock's backing store by reference - the same
// discipline dispatchOfferResponse.test.ts's header calls out.
//
// Runs in package.json's second, --no-check `deno test` invocation, because
// the domain modules carry pre-existing `deno check` errors tracked in
// scripts/deno-check-baseline.txt.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');

const customerSubmitOrderRating = ordersDomain.handlers.customerSubmitOrderRating;
if (typeof customerSubmitOrderRating !== 'function') {
  throw new Error('ordersDomain.handlers.customerSubmitOrderRating is not registered.');
}

const customerGetPendingRatings = ordersDomain.handlers.customerGetPendingRatings;
if (typeof customerGetPendingRatings !== 'function') {
  throw new Error('ordersDomain.handlers.customerGetPendingRatings is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const expectClose = (actual: number, expected: number, label: string, epsilon = 0.001) => {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${label}: expected ~${expected}, got ${actual}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const CUSTOMER_ID = 'customer-rating-1';
const OTHER_CUSTOMER_ID = 'customer-rating-2';
const RESTAURANT_ID = 'restaurant-rating-1';
const COURIER_ID = 'rider-rating-1';
const ORDER_ID = 'order-rating-1';

const customerContext = (uid: string) => ({
  email: `${uid}@example.test`,
  role: 'customer',
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role: 'customer', accountDisabled: false },
});

type Row = Record<string, unknown>;

const snapshot = (row: Row) => ({ ...row });

/**
 * Minimal postgrest-shaped in-memory table, copied from
 * dispatchOfferResponse.test.ts (`.eq`/`.in` filter for real, `.order`
 * applies, `.maybeSingle` unwraps, plainly awaiting the builder resolves to
 * the filtered array).
 */
const createTable = (initialRows: Row[]) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));

  const query = () => {
    let filtered = [...rows];
    let orderCol: string | null = null;
    let orderAscending = true;

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
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAscending = opts?.ascending !== false;
        return builder;
      },
      async maybeSingle() {
        return { data: filtered[0] ? snapshot(filtered[0]) : null, error: null };
      },
      async single() {
        return { data: filtered[0] ? snapshot(filtered[0]) : null, error: null };
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        let result = filtered;
        if (orderCol) {
          const col = orderCol;
          result = [...result].sort((a, b) => {
            const av = a[col] as never;
            const bv = b[col] as never;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return orderAscending ? cmp : -cmp;
          });
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
  };
};

const buildOrderRow = (overrides: Partial<Row> = {}): Row => ({
  createdAt: new Date().toISOString(),
  customerId: CUSTOMER_ID,
  id: ORDER_ID,
  restaurantId: RESTAURANT_ID,
  restaurantName: 'Test Kitchen',
  status: 'delivered',
  updatedAt: new Date().toISOString(),
  ...overrides,
});

type MockOptions = {
  orders?: Row[];
  assignments?: Row[];
  ratings?: Row[];
  restaurant?: Row;
  rider?: Row;
};

/**
 * Installs the table + rpc mocks. ebuy_submit_order_rating's rpc mock mirrors
 * the real function's guards and its atomic aggregate-update formula exactly
 * - see the file header for why that fidelity is the point.
 */
const installMocks = (options: MockOptions = {}) => {
  const tables: Record<string, ReturnType<typeof createTable>> = {
    CustomerOrder: createTable(options.orders ?? [buildOrderRow()]),
    DeliveryAssignment: createTable(options.assignments ?? []),
    OrderRating: createTable(options.ratings ?? []),
    RestaurantRecord: createTable([
      options.restaurant ?? { id: RESTAURANT_ID, ratingAverage: null, ratingCount: 0 },
    ]),
    DispatchRiderRecord: createTable([options.rider ?? { id: COURIER_ID, ratingAverage: null, ratingCount: 0 }]),
  };

  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const found = tables[table];
    if (!found) {
      throw new Error(`orderRatings.test.ts: unexpected table "${table}"`);
    }
    return found;
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    rpcCalls.push({ fn, params });

    if (fn !== 'ebuy_submit_order_rating') {
      throw new Error(`orderRatings.test.ts: unexpected rpc "${fn}"`);
    }

    const orderId = params.p_order_id as string;
    const customerId = params.p_customer_id as string;
    const restaurantScore = params.p_restaurant_score as number;
    const courierScore = (params.p_courier_score as number | null) ?? null;
    const comment = (params.p_comment as string | null) ?? null;

    const order = tables.CustomerOrder.rows.find((row) => row.id === orderId);
    if (!order) {
      return { data: [{ submitted: false, reason: 'order_not_found', ratingId: null, restaurantId: null }], error: null };
    }

    if (order.customerId !== customerId) {
      return {
        data: [{ submitted: false, reason: 'not_owner', ratingId: null, restaurantId: order.restaurantId }],
        error: null,
      };
    }

    if (order.status !== 'delivered') {
      return {
        data: [{ submitted: false, reason: 'not_delivered', ratingId: null, restaurantId: order.restaurantId }],
        error: null,
      };
    }

    const assignment = tables.DeliveryAssignment.rows.find((row) => row.orderId === orderId);
    const courierId = (assignment?.courierId as string | null | undefined) ?? null;

    // Stands in for the real UNIQUE-constraint-driven unique_violation catch:
    // a second insert for the same orderId never lands, so the aggregate
    // below is never reached a second time for this order.
    if (tables.OrderRating.rows.some((row) => row.orderId === orderId)) {
      return {
        data: [{ submitted: false, reason: 'already_rated', ratingId: null, restaurantId: order.restaurantId }],
        error: null,
      };
    }

    const ratingId = `rating-${orderId}`;
    tables.OrderRating.rows.push({
      comment,
      courierId,
      courierScore,
      createdAt: new Date().toISOString(),
      customerId,
      id: ratingId,
      orderId,
      restaurantId: order.restaurantId,
      restaurantScore,
    });

    // THE ATOMIC AGGREGATE UPDATE, mirroring the migration's own formula
    // exactly: (avg * count + score) / (count + 1), never read into the
    // caller and written back.
    const restaurant = tables.RestaurantRecord.rows.find((row) => row.id === order.restaurantId)!;
    const prevRestaurantCount = (restaurant.ratingCount as number) ?? 0;
    const prevRestaurantAverage = (restaurant.ratingAverage as number) ?? 0;
    restaurant.ratingAverage = (prevRestaurantAverage * prevRestaurantCount + restaurantScore) / (prevRestaurantCount + 1);
    restaurant.ratingCount = prevRestaurantCount + 1;

    // Courier aggregate ONLY when a score was given AND the order actually
    // had a courier - the exact guard under test in the "courier score only
    // updates the rider when present" block below.
    if (courierScore !== null && courierId) {
      const rider = tables.DispatchRiderRecord.rows.find((row) => row.id === courierId);
      if (rider) {
        const prevRiderCount = (rider.ratingCount as number) ?? 0;
        const prevRiderAverage = (rider.ratingAverage as number) ?? 0;
        rider.ratingAverage = (prevRiderAverage * prevRiderCount + courierScore) / (prevRiderCount + 1);
        rider.ratingCount = prevRiderCount + 1;
      }
    }

    return { data: [{ submitted: true, reason: 'submitted', ratingId, restaurantId: order.restaurantId }], error: null };
  };

  return {
    rating: (orderId: string = ORDER_ID) => tables.OrderRating.rows.find((row) => row.orderId === orderId) ?? null,
    ratings: () => tables.OrderRating.rows,
    restaurant: () => tables.RestaurantRecord.rows.find((row) => row.id === RESTAURANT_ID)!,
    rider: () => tables.DispatchRiderRecord.rows.find((row) => row.id === COURIER_ID)!,
    rpcCalls,
    tables,
  };
};

const callSubmit = (uid: string, data: Record<string, unknown>) =>
  customerSubmitOrderRating({ context: customerContext(uid), data, request: fakeRequest() });

const callSafely = async (uid: string, data: Record<string, unknown>): Promise<{ status: number; body?: unknown }> => {
  try {
    const response = await callSubmit(uid, data);
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return { status: (error as { status?: number }).status ?? 0 };
  }
};

// ---------------------------------------------------------------------------
// 1. NON-DELIVERED ORDER — rejected.
// ---------------------------------------------------------------------------

Deno.test('customerSubmitOrderRating: a non-delivered order is rejected and nothing is stored', async () => {
  const state = installMocks({ orders: [buildOrderRow({ status: 'accepted' })] });

  const result = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 5 });

  expectEqual(result.status, 412, 'a non-delivered order is refused with 412');
  expectEqual(state.ratings().length, 0, 'no rating row was stored');
  expectEqual(state.restaurant().ratingCount, 0, 'the restaurant aggregate was never touched');
});

Deno.test('customerSubmitOrderRating: every terminal-but-not-delivered status is also rejected', async () => {
  for (const status of ['cancelled', 'rejected', 'failed_delivery', 'placed', 'preparing']) {
    const state = installMocks({ orders: [buildOrderRow({ status })] });
    const result = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 4 });
    expectEqual(result.status, 412, `status "${status}" is refused with 412`);
    expectEqual(state.ratings().length, 0, `status "${status}": no rating stored`);
  }
});

// ---------------------------------------------------------------------------
// 2. NOT THE CUSTOMER'S OWN ORDER — rejected.
// ---------------------------------------------------------------------------

Deno.test('customerSubmitOrderRating: an order the customer does not own is rejected and nothing is stored', async () => {
  const state = installMocks({ orders: [buildOrderRow({ customerId: CUSTOMER_ID })] });

  const result = await callSafely(OTHER_CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 5 });

  expectEqual(result.status, 403, 'a non-owner is refused with 403');
  expectEqual(state.ratings().length, 0, 'no rating row was stored');
  expectEqual(state.restaurant().ratingCount, 0, 'the restaurant aggregate was never touched');
});

// ---------------------------------------------------------------------------
// 3. RATING TWICE — rejected via the "already rated" outcome (stands in for
//    the real UNIQUE-constraint-driven unique_violation).
// ---------------------------------------------------------------------------

Deno.test('customerSubmitOrderRating: rating the same order twice is rejected on the second attempt, and the aggregate is incremented only once', async () => {
  const state = installMocks();

  const first = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 5 });
  expectEqual(first.status, 200, 'the first rating succeeds');

  const second = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 2 });
  expectEqual(second.status, 409, 'the second rating for the same order is refused with a conflict');

  expectEqual(state.ratings().length, 1, 'exactly one rating row exists');
  expectEqual(state.restaurant().ratingCount, 1, 'the restaurant rating count was incremented exactly once');
  expectEqual(state.restaurant().ratingAverage, 5, 'the average reflects only the first (accepted) rating, never the rejected retry');
});

// ---------------------------------------------------------------------------
// 4. INCREMENTAL AVERAGE MATHS — 5, then 3 -> 4.0, then 3 again -> 3.667.
// ---------------------------------------------------------------------------

Deno.test('customerSubmitOrderRating: the incremental average is correct across several ratings on the same restaurant', async () => {
  const orderA = buildOrderRow({ id: 'order-rating-a' });
  const orderB = buildOrderRow({ id: 'order-rating-b' });
  const orderC = buildOrderRow({ id: 'order-rating-c' });
  const state = installMocks({ orders: [orderA, orderB, orderC] });

  const first = await callSafely(CUSTOMER_ID, { orderId: 'order-rating-a', restaurantScore: 5 });
  expectEqual(first.status, 200, 'first rating accepted');
  expectClose(state.restaurant().ratingAverage as number, 5.0, 'average after one rating (5)');
  expectEqual(state.restaurant().ratingCount, 1, 'count after one rating');

  const second = await callSafely(CUSTOMER_ID, { orderId: 'order-rating-b', restaurantScore: 3 });
  expectEqual(second.status, 200, 'second rating accepted');
  expectClose(state.restaurant().ratingAverage as number, 4.0, 'average after (5, 3)');
  expectEqual(state.restaurant().ratingCount, 2, 'count after two ratings');

  const third = await callSafely(CUSTOMER_ID, { orderId: 'order-rating-c', restaurantScore: 3 });
  expectEqual(third.status, 200, 'third rating accepted');
  expectClose(state.restaurant().ratingAverage as number, 3.667, 'average after (5, 3, 3) rounds to 3.667');
  expectEqual(state.restaurant().ratingCount, 3, 'count after three ratings');
});

// ---------------------------------------------------------------------------
// 5. COURIER SCORE — only updates the rider when a score was given AND the
//    order actually had a courier.
// ---------------------------------------------------------------------------

Deno.test('customerSubmitOrderRating: a courier score updates the rider when the order had a courier', async () => {
  const state = installMocks({ assignments: [{ orderId: ORDER_ID, courierId: COURIER_ID }] });

  const result = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 5, courierScore: 4 });

  expectEqual(result.status, 200, 'submission succeeds');
  expectEqual(state.rider().ratingCount, 1, 'the rider aggregate was incremented');
  expectClose(state.rider().ratingAverage as number, 4.0, 'the rider average reflects the courier score');
});

Deno.test('customerSubmitOrderRating: no courierScore given leaves the rider untouched even though the order had a courier', async () => {
  const state = installMocks({ assignments: [{ orderId: ORDER_ID, courierId: COURIER_ID }] });

  const result = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 5 });

  expectEqual(result.status, 200, 'submission succeeds');
  expectEqual(state.rider().ratingCount, 0, 'the rider aggregate is untouched — no score was given');
  expectEqual(state.rider().ratingAverage, null, 'the rider average stays null');
});

Deno.test('customerSubmitOrderRating: a courierScore on a pickup order (no courier on the assignment) leaves the rider untouched and does not error', async () => {
  // No DeliveryAssignment row at all — a pickup order, or a delivery with no
  // rider on record.
  const state = installMocks({ assignments: [] });

  const result = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 5, courierScore: 5 });

  expectEqual(result.status, 200, 'submission still succeeds');
  expectEqual(state.rider().ratingCount, 0, 'the rider aggregate is untouched — there was no courier to rate');
  expectEqual(state.restaurant().ratingCount, 1, 'the restaurant aggregate was still updated');
});

// ---------------------------------------------------------------------------
// 6. VALIDATION — out-of-range scores are refused before the rpc is ever
//    called (the DB check constraints are belt-and-braces, not the only gate).
// ---------------------------------------------------------------------------

Deno.test('customerSubmitOrderRating: an out-of-range restaurantScore is refused with 400 and never reaches the rpc', async () => {
  const state = installMocks();

  const tooHigh = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 6 });
  expectEqual(tooHigh.status, 400, 'restaurantScore 6 is refused');

  const tooLow = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 0 });
  expectEqual(tooLow.status, 400, 'restaurantScore 0 is refused');

  expectEqual(state.rpcCalls.length, 0, 'the rpc was never called for either invalid attempt');
});

Deno.test('customerSubmitOrderRating: an out-of-range courierScore is refused with 400 and never reaches the rpc', async () => {
  const state = installMocks();

  const result = await callSafely(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 5, courierScore: 7 });
  expectEqual(result.status, 400, 'courierScore 7 is refused');
  expectEqual(state.rpcCalls.length, 0, 'the rpc was never called');
});

// ---------------------------------------------------------------------------
// 7. HAPPY-PATH RESPONSE SHAPE.
// ---------------------------------------------------------------------------

Deno.test('customerSubmitOrderRating: a successful submission returns the orderId, ratingId and restaurantId', async () => {
  installMocks();

  const response = await callSubmit(CUSTOMER_ID, { orderId: ORDER_ID, restaurantScore: 5 });
  expectEqual(response.status, 200, 'submission succeeds');

  const body = (await response.json()) as { data?: { orderId?: string; ratingId?: string; restaurantId?: string } };
  expectEqual(body.data?.orderId, ORDER_ID, 'orderId echoed back');
  expectEqual(body.data?.restaurantId, RESTAURANT_ID, 'restaurantId included');
  expectEqual(typeof body.data?.ratingId, 'string', 'a ratingId is returned');
});

// ---------------------------------------------------------------------------
// 8. customerGetPendingRatings.
// ---------------------------------------------------------------------------

const callPending = async (uid: string) => {
  const response = await customerGetPendingRatings({ context: customerContext(uid), data: {}, request: fakeRequest() });
  const body = (await response.json()) as { data?: { orders?: Array<{ orderId?: string }> } };
  return { response, orderIds: (body.data?.orders ?? []).map((order) => order.orderId) };
};

Deno.test('customerGetPendingRatings: a delivered order with no rating yet is pending', async () => {
  installMocks({ orders: [buildOrderRow({ status: 'delivered' })] });

  const { response, orderIds } = await callPending(CUSTOMER_ID);
  expectEqual(response.status, 200, 'request succeeds');
  expectEqual(orderIds.includes(ORDER_ID), true, 'the delivered, unrated order is pending');
});

Deno.test('customerGetPendingRatings: an already-rated delivered order is excluded', async () => {
  installMocks({ ratings: [{ orderId: ORDER_ID, restaurantId: RESTAURANT_ID }] });

  const { orderIds } = await callPending(CUSTOMER_ID);
  expectEqual(orderIds.includes(ORDER_ID), false, 'a rated order is not pending');
});

Deno.test('customerGetPendingRatings: a non-delivered order never appears, rated or not', async () => {
  installMocks({ orders: [buildOrderRow({ status: 'accepted' })] });

  const { orderIds } = await callPending(CUSTOMER_ID);
  expectEqual(orderIds.includes(ORDER_ID), false, 'a non-delivered order is never pending');
});

Deno.test('customerGetPendingRatings: only the calling customer\'s own orders are returned', async () => {
  installMocks({ orders: [buildOrderRow({ customerId: OTHER_CUSTOMER_ID })] });

  const { orderIds } = await callPending(CUSTOMER_ID);
  expectEqual(orderIds.includes(ORDER_ID), false, 'another customer\'s delivered order is not returned');
});
