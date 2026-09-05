// Handler-level tests for the delivery-offer state machine (Task 10 / D2).
//
// These drive the REAL handlers out of the REAL domain map -
// dispatchDomain.handlers.dispatchAcceptOffer / dispatchDeclineOffer - behind
// a `typeof !== 'function'` guard, the same way dispatchLoadRelease.test.ts
// does, and for the same reason it had to: on this plan a test has twice
// passed with its bug fully reintroduced, both times because the test called
// a shared helper directly and never exercised the handler that actually
// regressed.
//
// WHAT IS ASSERTED. Stored rows and counters, never "a function was called":
// the exact DeliveryOffer.status, the exact DeliveryAssignment.courierId, and
// the exact activeLoad. Both handlers swallow some errors by design, so an
// assertion on whether an exception propagated would prove nothing.
//
// THE INVARIANT UNDER TEST is Task 9's, unchanged:
//
//     For each (order, courier) claim, exactly ONE decrement of activeLoad
//     ever lands - across the partner, dispatcher, cancel and reassignment
//     paths, under any interleaving.
//
// Task 10 could only break it by creating a claim that no path will ever
// release. So every test here asserts the counter after the fact, and the
// four non-accepting outcomes (decline, expire, supersede, exhaustion) each
// assert activeLoad is UNCHANGED - a claim that was never created cannot leak.
//
// The rpc mock is STRICT: it implements only the offer/claim functions and
// throws on any other name, in particular ebuy_adjust_dispatch_rider_load.
// A regression that goes back to claiming at selection time, or that reaches
// for a bare load adjustment, fails loudly here instead of silently leaking.
//
// Every read returns a COPY. Task 9's round-4 harness returned live row
// references, so a handler's "snapshot" mutated itself and a race test passed
// with the fix fully reverted.
//
// Runs in package.json's second, --no-check `deno test` invocation, because
// the domain modules carry pre-existing `deno check` errors tracked in
// scripts/deno-check-baseline.txt.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./dispatch.ts');
const { serviceClient } = await import('../client.ts');
const { sweepDispatchOffers } = await import('../dispatchOfferSweep.ts');

const dispatchAcceptOffer = dispatchDomain.handlers.dispatchAcceptOffer;
if (typeof dispatchAcceptOffer !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchAcceptOffer is not registered.');
}

const dispatchDeclineOffer = dispatchDomain.handlers.dispatchDeclineOffer;
if (typeof dispatchDeclineOffer !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchDeclineOffer is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const ORDER_ID = 'order-offer-1';
const RESTAURANT_ID = 'restaurant-offer-1';
const RIDER_A = 'rider-offer-a';
const RIDER_B = 'rider-offer-b';

const riderContext = (uid: string) => ({
  email: `${uid}@example.test`,
  role: 'dispatch',
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role: 'dispatch', accountDisabled: false },
});

const adminContext = (uid: string) => ({
  email: `${uid}@example.test`,
  role: 'admin',
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role: 'admin', accountDisabled: false },
});

type Row = Record<string, unknown>;

const snapshot = (row: Row) => ({ ...row });

/**
 * Minimal postgrest-shaped in-memory table. `.eq`/`.in` filter for real,
 * `.order` applies, `.maybeSingle` unwraps, and plainly awaiting the builder
 * resolves to the filtered array - matching however each call site chains,
 * without hand-coding every combination.
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
      is(col: string, val: unknown) {
        filtered = filtered.filter((row) => (row[col] ?? null) === val);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAscending = opts?.ascending !== false;
        return builder;
      },
      limit() {
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

const buildOrderRow = (status: string): Row => ({
  createdAt: new Date().toISOString(),
  customerId: 'customer-offer-1',
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

/** Mirrors ebuy_lock_order_status, which is what the SQL guards actually use. */
const normalizeStatus = (value: unknown) => {
  const status = typeof value === 'string' && value.trim() ? value.trim() : 'draft';
  if (status === 'pending' || status === 'confirmed') return 'placed';
  if (status === 'ready') return 'ready_for_pickup';
  return status;
};

const OFFERABLE_STATUSES = ['accepted', 'preparing', 'ready_for_pickup'];
const MAX_OFFERS = 3;

type MockOptions = {
  /** Extra riders available for re-offer, in preference order. */
  riders?: string[];
  /** Offers already on the order at request start. */
  offers?: Row[];
  /** Courier already holding the assignment. `null` = unclaimed row absent. */
  assignmentCourierId?: string | null;
  /** Extra orders (id + status) seeded alongside ORDER_ID, for sweep batching tests. */
  extraOrders?: Array<{ id: string; status: string }>;
  /** Offers belonging to the extra orders. */
  extraOffers?: Row[];
  /** Pre-existing DeliveryEvent rows, e.g. a dispatch_offers_exhausted marker. */
  events?: Row[];
};

/**
 * Installs the table + rpc mocks. The rpc mock mirrors each SQL function's
 * guards precisely - that fidelity is the entire value of these tests, since
 * the guards are the thing under test and they live in SQL.
 *
 * state.load deliberately does NOT clamp at zero the way production's
 * `greatest(0, ...)` does: an over-decrement must surface as a negative
 * number rather than being silently absorbed.
 */
const installMocks = (orderStatus: string, options: MockOptions = {}) => {
  const riders = options.riders ?? [RIDER_A, RIDER_B];

  const state = {
    broadcasts: 0,
    load: Object.fromEntries(riders.map((id) => [id, 0])) as Record<string, number>,
    rpcCalls: [] as Array<{ fn: string; params: Record<string, unknown> }>,
  };

  const tables: Record<string, ReturnType<typeof createTable>> = {
    CustomerOrder: createTable([
      buildOrderRow(orderStatus),
      ...(options.extraOrders ?? []).map((entry) => ({
        ...buildOrderRow(entry.status),
        id: entry.id,
      })),
    ]),
    DeliveryAssignment: createTable(
      options.assignmentCourierId === undefined
        ? []
        : [
          {
            assignedAt: new Date().toISOString(),
            courierId: options.assignmentCourierId,
            courierName: 'Existing Rider',
            dispatchId: null,
            dispatchOwnerId: options.assignmentCourierId,
            loadReleasedAt: null,
            orderId: ORDER_ID,
          },
        ]
    ),
    DeliveryEvent: createTable(options.events ?? []),
    OrderItem: createTable([]),
    RestaurantUser: createTable([]),
    DeliveryOffer: createTable([...(options.offers ?? []), ...(options.extraOffers ?? [])]),
    DispatchRiderRecord: createTable(
      riders.map((id, index) => ({
        activeLoad: 0,
        displayName: `Rider ${index + 1}`,
        id,
        latitude: null,
        longitude: null,
        status: 'Available',
        vehicleType: 'bike',
      }))
    ),
    // loadDispatchWeights reads this; without it the loader logs a warning and
    // falls back to identical defaults. Modelled so the re-offer path exercises
    // the real scoring inputs rather than the fallback branch.
    PlatformSettings: createTable([{ id: 'dispatchWeights', value: { distance: 0.15, load: 1.0 } }]),
    RestaurantRecord: createTable([{ id: RESTAURANT_ID, latitude: null, longitude: null, ownerId: 'owner-1' }]),
    UserAccount: createTable(
      riders.map((id) => ({ accountDisabled: false, expoPushToken: null, uid: id }))
    ),
    UserRole: createTable(riders.map((id) => ({ restaurantId: RESTAURANT_ID, role: 'dispatch', userId: id }))),
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const found = tables[table];
    if (!found) {
      throw new Error(`dispatchOfferResponse.test.ts: unexpected table "${table}"`);
    }
    return found;
  };

  const offerRows = () => tables.DeliveryOffer.rows;
  const orderRow = (id: string = ORDER_ID) =>
    tables.CustomerOrder.rows.find((row) => row.id === id) ?? null;
  const assignmentRow = (id: string = ORDER_ID) =>
    tables.DeliveryAssignment.rows.find((row) => row.orderId === id) ?? null;

  /** Mirrors ebuy_claim_dispatch_assignment: locked status guard + courierId is null. */
  const claim = (courierId: string, courierName: string) => {
    const status = normalizeStatus(orderRow()?.status);
    if (!OFFERABLE_STATUSES.includes(status)) {
      return false;
    }

    const existing = assignmentRow();
    if (existing) {
      if (existing.courierId) {
        return false;
      }
      Object.assign(existing, {
        courierId,
        courierName,
        dispatchOwnerId: courierId,
        loadReleasedAt: null,
      });
    } else {
      tables.DeliveryAssignment.rows.push({
        assignedAt: new Date().toISOString(),
        courierId,
        courierName,
        dispatchId: null,
        dispatchOwnerId: courierId,
        loadReleasedAt: null,
        orderId: ORDER_ID,
      });
    }

    state.load[courierId] = (state.load[courierId] ?? 0) + 1;
    return true;
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, params });
    const now = new Date().toISOString();

    if (fn === 'ebuy_accept_dispatch_offer') {
      const offerId = params.p_offer_id as string;
      const courierId = params.p_courier_id as string;
      const offer = offerRows().find((row) => row.id === offerId && row.courierId === courierId);

      if (!offer) {
        return { data: [{ accepted: false, orderId: null, reason: 'offer_not_found' }], error: null };
      }

      if (offer.status !== 'pending') {
        return {
          data: [{ accepted: false, orderId: offer.orderId, reason: `offer_${offer.status}` }],
          error: null,
        };
      }

      if (Date.parse(offer.respondsBy as string) <= Date.now()) {
        Object.assign(offer, { respondedAt: now, status: 'expired' });
        return { data: [{ accepted: false, orderId: offer.orderId, reason: 'offer_expired' }], error: null };
      }

      if (!claim(courierId, params.p_courier_name as string)) {
        // Loser / terminal order: marked superseded, NOT accepted, and
        // nothing was incremented - so there is nothing to release.
        Object.assign(offer, { respondedAt: now, status: 'superseded' });
        return { data: [{ accepted: false, orderId: offer.orderId, reason: 'claim_refused' }], error: null };
      }

      Object.assign(offer, { respondedAt: now, status: 'accepted' });
      for (const other of offerRows()) {
        if (other.orderId === offer.orderId && other.id !== offer.id && other.status === 'pending') {
          Object.assign(other, { respondedAt: now, status: 'superseded' });
        }
      }

      return { data: [{ accepted: true, orderId: offer.orderId, reason: 'accepted' }], error: null };
    }

    if (fn === 'ebuy_decline_dispatch_offer') {
      const offerId = params.p_offer_id as string;
      const courierId = params.p_courier_id as string;
      const offer = offerRows().find((row) => row.id === offerId && row.courierId === courierId);

      if (!offer) {
        return { data: [{ declined: false, orderId: null, reason: 'offer_not_found' }], error: null };
      }

      if (offer.status !== 'pending') {
        return {
          data: [{ declined: false, orderId: offer.orderId, reason: `offer_${offer.status}` }],
          error: null,
        };
      }

      Object.assign(offer, { respondedAt: now, status: 'declined' });
      return { data: [{ declined: true, orderId: offer.orderId, reason: 'declined' }], error: null };
    }

    if (fn === 'ebuy_offer_dispatch_assignment') {
      const courierId = params.p_courier_id as string;
      const targetOrderId = (params.p_order_id as string) ?? ORDER_ID;
      const status = normalizeStatus(orderRow(targetOrderId)?.status);

      if (!OFFERABLE_STATUSES.includes(status)) {
        return {
          data: [{ offerId: null, offered: false, reason: 'order_not_offerable', sequence: null }],
          error: null,
        };
      }

      if (assignmentRow(targetOrderId)?.courierId) {
        return {
          data: [{ offerId: null, offered: false, reason: 'already_assigned', sequence: null }],
          error: null,
        };
      }

      const forOrder = offerRows().filter((row) => row.orderId === targetOrderId);
      if (forOrder.some((row) => row.status === 'pending')) {
        return {
          data: [{ offerId: null, offered: false, reason: 'offer_outstanding', sequence: null }],
          error: null,
        };
      }
      if (forOrder.length >= MAX_OFFERS) {
        return { data: [{ offerId: null, offered: false, reason: 'exhausted', sequence: null }], error: null };
      }
      if (forOrder.some((row) => row.courierId === courierId)) {
        return {
          data: [{ offerId: null, offered: false, reason: 'already_offered', sequence: null }],
          error: null,
        };
      }

      const sequence = forOrder.length + 1;
      const offerId = `offer-${targetOrderId}-${sequence}`;
      offerRows().push({
        courierId,
        id: offerId,
        offeredAt: now,
        orderId: targetOrderId,
        respondedAt: null,
        respondsBy: new Date(Date.now() + 45_000).toISOString(),
        sequence,
        status: 'pending',
      });

      return { data: [{ offerId, offered: true, reason: 'offered', sequence }], error: null };
    }

    if (fn === 'ebuy_expire_dispatch_offers') {
      // Idempotent by predicate: only `pending` rows past their deadline.
      const due = offerRows().filter(
        (row) => row.status === 'pending' && Date.parse(row.respondsBy as string) <= Date.now()
      );
      for (const row of due) {
        Object.assign(row, { respondedAt: now, status: 'expired' });
      }
      return {
        data: due.map((row) => ({ courierId: row.courierId, offerId: row.id, orderId: row.orderId })),
        error: null,
      };
    }

    if (fn === 'ebuy_list_dispatch_reoffer_candidates') {
      // Mirrors ebuy_list_dispatch_reoffer_candidates including the two
      // properties that make starvation observable at all: it is ordered by
      // min("offeredAt") and capped at p_limit. Modelling only the predicate
      // (the previous version) made a permanently-eligible candidate
      // indistinguishable from a healthy one - the exact blind spot that let
      // the starvation defect through review-clean.
      const limit = Math.max(1, (params.p_limit as number) ?? 50);
      const maxOffers = Math.max(1, (params.p_max_offers as number) ?? MAX_OFFERS);

      const candidates = tables.CustomerOrder.rows
        .filter((order) => {
          const id = order.id as string;
          const forOrder = offerRows().filter((row) => row.orderId === id);
          return (
            OFFERABLE_STATUSES.includes(normalizeStatus(order.status)) &&
            !assignmentRow(id)?.courierId &&
            forOrder.length > 0 &&
            !forOrder.some((row) => row.status === 'pending') &&
            forOrder.length < maxOffers &&
            // THE STARVATION GUARD: an order already handed to the manual
            // queue stops being swept.
            !tables.DeliveryEvent.rows.some(
              (event) => event.orderId === id && event.eventType === 'dispatch_offers_exhausted'
            )
          );
        })
        .map((order) => {
          const id = order.id as string;
          const earliest = offerRows()
            .filter((row) => row.orderId === id)
            .reduce(
              (min, row) => Math.min(min, Date.parse(row.offeredAt as string) || 0),
              Number.POSITIVE_INFINITY
            );
          return { earliest, orderId: id };
        })
        .sort((a, b) => a.earliest - b.earliest)
        .slice(0, limit)
        .map((entry) => ({ orderId: entry.orderId }));

      return { data: candidates, error: null };
    }

    if (fn === 'ebuy_reassign_dispatch_assignment_courier') {
      // Task 9's compare-and-swap, unmodified by Task 10. Mirrored here so the
      // manual-assignment path can be driven end to end.
      const targetOrderId = params.p_order_id as string;
      const courierId = params.p_courier_id as string;
      const status = normalizeStatus(orderRow(targetOrderId)?.status);

      if (!OFFERABLE_STATUSES.includes(status)) {
        return { data: [{ orderStatus: status, previousCourierId: null, reassigned: false }], error: null };
      }

      const existing = assignmentRow(targetOrderId);
      const previous = (existing?.courierId as string | null) ?? null;

      if (existing?.loadReleasedAt) {
        return { data: [{ orderStatus: status, previousCourierId: previous, reassigned: false }], error: null };
      }

      if (existing) {
        Object.assign(existing, {
          courierId,
          courierName: params.p_courier_name,
          dispatchOwnerId: courierId,
          loadReleasedAt: null,
        });
      } else {
        tables.DeliveryAssignment.rows.push({
          assignedAt: now,
          courierId,
          courierName: params.p_courier_name,
          dispatchId: params.p_dispatch_id ?? null,
          dispatchOwnerId: courierId,
          loadReleasedAt: null,
          orderId: targetOrderId,
        });
      }

      if (previous !== courierId) {
        if (previous) {
          state.load[previous] = (state.load[previous] ?? 0) - 1;
        }
        state.load[courierId] = (state.load[courierId] ?? 0) + 1;
      }

      return { data: [{ orderStatus: status, previousCourierId: previous, reassigned: true }], error: null };
    }

    // In particular ebuy_adjust_dispatch_rider_load: a handler reaching for a
    // bare load adjustment is exactly the regression these tests exist to catch.
    throw new Error(`dispatchOfferResponse.test.ts: unexpected rpc "${fn}"`);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/realtime/v1/api/broadcast')) {
      state.broadcasts += 1;
      return new Response('{}', { status: 200 });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  return {
    ...state,
    assignment: assignmentRow,
    load: state.load,
    offers: offerRows,
    order: orderRow,
    tables,
  };
};

const pendingOffer = (courierId: string, id = 'offer-1', ttlMs = 45_000): Row => ({
  courierId,
  id,
  offeredAt: new Date().toISOString(),
  orderId: ORDER_ID,
  respondedAt: null,
  respondsBy: new Date(Date.now() + ttlMs).toISOString(),
  sequence: 1,
  status: 'pending',
});

const callHandler = (
  // deno-lint-ignore no-explicit-any
  handler: any,
  uid: string,
  data: Record<string, unknown>
) => handler({ context: riderContext(uid), data, request: fakeRequest() });

// ---------------------------------------------------------------------------
// 1. ACCEPT - the only outcome that creates a claim.
// ---------------------------------------------------------------------------

Deno.test('dispatchAcceptOffer: accepting creates the assignment and increments activeLoad exactly once', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A)] });

  const response = await callHandler(dispatchAcceptOffer, RIDER_A, { offerId: 'offer-1' });

  expectEqual(response.status, 200, 'accept succeeds');
  expectEqual(state.offers()[0]?.status, 'accepted', 'the offer is marked accepted');
  expectEqual(state.assignment()?.courierId, RIDER_A, 'the assignment now names the accepting rider');
  expectEqual(state.assignment()?.loadReleasedAt, null, 'the claim is live, not pre-released');
  expectEqual(state.load[RIDER_A], 1, 'activeLoad incremented exactly once');
  expectEqual(state.load[RIDER_B], 0, 'no other rider was touched');
});

// ---------------------------------------------------------------------------
// 2. DOUBLE-ACCEPT - only one offer per order can ever win.
// ---------------------------------------------------------------------------

Deno.test('dispatchAcceptOffer: accepting the same offer twice increments activeLoad only once', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A)] });

  const first = await callHandler(dispatchAcceptOffer, RIDER_A, { offerId: 'offer-1' });
  expectEqual(first.status, 200, 'first accept wins');

  // A double-tapped button, or a retried request.
  let secondStatus = 0;
  try {
    const second = await callHandler(dispatchAcceptOffer, RIDER_A, { offerId: 'offer-1' });
    secondStatus = second.status;
  } catch (error) {
    secondStatus = (error as { status?: number }).status ?? 0;
  }

  expectEqual(secondStatus, 409, 'the second accept is refused with a conflict');
  expectEqual(state.load[RIDER_A], 1, 'activeLoad STILL 1 - no double increment');
  expectEqual(state.offers().filter((row) => row.status === 'accepted').length, 1, 'exactly one accepted offer');
});

Deno.test('dispatchAcceptOffer: two riders racing the same order produce exactly one claim', async () => {
  // Two pending offers coexisting is only reachable if the partial unique
  // index were dropped - the guarantee must not depend on that index, so the
  // claim compare-and-swap is driven directly.
  const state = installMocks('accepted', {
    offers: [pendingOffer(RIDER_A, 'offer-1'), { ...pendingOffer(RIDER_B, 'offer-2'), sequence: 2 }],
  });

  const first = await callHandler(dispatchAcceptOffer, RIDER_A, { offerId: 'offer-1' });
  expectEqual(first.status, 200, 'the first rider wins the claim');

  let loserStatus = 0;
  try {
    const second = await callHandler(dispatchAcceptOffer, RIDER_B, { offerId: 'offer-2' });
    loserStatus = second.status;
  } catch (error) {
    loserStatus = (error as { status?: number }).status ?? 0;
  }

  expectEqual(loserStatus, 409, 'the losing rider is refused');
  expectEqual(state.assignment()?.courierId, RIDER_A, 'the winner holds the order');
  expectEqual(state.load[RIDER_A], 1, 'the winner is incremented once');
  // THE CRITICAL ASSERTION: the loser must carry no claim, because nothing
  // will ever release one for them.
  expectEqual(state.load[RIDER_B], 0, 'the LOSER was never incremented - nothing to leak');
  expectEqual(
    state.offers().find((row) => row.id === 'offer-2')?.status,
    'superseded',
    "the loser's offer is superseded, not accepted"
  );
});

// ---------------------------------------------------------------------------
// 3. ACCEPT OF A SUPERSEDED / EXPIRED OFFER.
// ---------------------------------------------------------------------------

Deno.test('dispatchAcceptOffer: accepting a superseded offer is refused and touches no counter', async () => {
  const state = installMocks('accepted', {
    offers: [{ ...pendingOffer(RIDER_B, 'offer-2'), status: 'superseded' }],
  });

  let status = 0;
  try {
    const response = await callHandler(dispatchAcceptOffer, RIDER_B, { offerId: 'offer-2' });
    status = response.status;
  } catch (error) {
    status = (error as { status?: number }).status ?? 0;
  }

  expectEqual(status, 409, 'a superseded offer cannot be accepted');
  expectEqual(state.load[RIDER_B], 0, 'activeLoad untouched');
  expectEqual(state.assignment(), null, 'no assignment was created');
});

Deno.test('dispatchAcceptOffer: accepting after the deadline is refused and touches no counter', async () => {
  // Deadline already in the past - the sweep has not run yet, so the row is
  // still `pending`. The SQL deadline check, not cron latency, decides.
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A, 'offer-1', -1000)] });

  let status = 0;
  try {
    const response = await callHandler(dispatchAcceptOffer, RIDER_A, { offerId: 'offer-1' });
    status = response.status;
  } catch (error) {
    status = (error as { status?: number }).status ?? 0;
  }

  expectEqual(status, 410, 'an overdue offer is gone');
  expectEqual(state.offers()[0]?.status, 'expired', 'the overdue offer is flipped to expired');
  expectEqual(state.load[RIDER_A], 0, 'activeLoad untouched');
  expectEqual(state.assignment(), null, 'no assignment was created');
});

// ---------------------------------------------------------------------------
// 4. ACCEPT ON AN ORDER THAT WENT TERMINAL WHILE THE OFFER WAS OUTSTANDING.
//
// This is the case that would have been a PERMANENT leak under the rejected
// "claim at selection" design: a +1 landing on an order that will never
// transition again, so no release path can ever fire for it.
// ---------------------------------------------------------------------------

Deno.test('dispatchAcceptOffer: accepting an order that went terminal mid-offer creates no claim', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A)] });

  // The customer cancels (or the restaurant rejects) while the rider's screen
  // sits open on a live offer.
  Object.assign(state.order(), { status: 'cancelled' });

  let status = 0;
  try {
    const response = await callHandler(dispatchAcceptOffer, RIDER_A, { offerId: 'offer-1' });
    status = response.status;
  } catch (error) {
    status = (error as { status?: number }).status ?? 0;
  }

  expectEqual(status, 409, 'the accept is refused against a terminal order');
  expectEqual(state.load[RIDER_A], 0, 'NO claim was created on a terminal order - nothing could ever release it');
  expectEqual(state.assignment(), null, 'no assignment row was written');
  expectEqual(state.offers()[0]?.status, 'superseded', 'the offer is closed out, not left pending');
});

// ---------------------------------------------------------------------------
// 5. DECLINE -> RE-OFFER, excluding the decliner.
// ---------------------------------------------------------------------------

Deno.test('dispatchDeclineOffer: declining re-offers to the next rider and touches no counter', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A)] });

  const response = await callHandler(dispatchDeclineOffer, RIDER_A, { offerId: 'offer-1' });

  expectEqual(response.status, 200, 'decline succeeds');
  expectEqual(state.offers()[0]?.status, 'declined', "the decliner's offer is marked declined");
  expectEqual(state.offers().length, 2, 'a re-offer was created');

  const reoffer = state.offers()[1];
  expectEqual(reoffer?.courierId, RIDER_B, 'the re-offer went to the OTHER rider');
  expectEqual(reoffer?.status, 'pending', 'the re-offer is live');
  expectEqual(reoffer?.sequence, 2, 'the re-offer is sequence 2');

  // A decline was never a claim.
  expectEqual(state.load[RIDER_A], 0, 'the decliner was never incremented');
  expectEqual(state.load[RIDER_B], 0, 'the new offeree is not incremented either - only accept claims');
  expectEqual(state.assignment(), null, 'declining creates no assignment');
});

Deno.test('dispatchDeclineOffer: a rider is never re-offered an order they already declined', async () => {
  // Only one rider exists, so the exclusion set is the only thing that can
  // prevent re-offering the decliner to themselves.
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A)], riders: [RIDER_A] });

  await callHandler(dispatchDeclineOffer, RIDER_A, { offerId: 'offer-1' });

  expectEqual(state.offers().length, 1, 'no second offer was created');
  expectEqual(state.offers()[0]?.status, 'declined', 'the single offer stays declined');
  expectEqual(state.load[RIDER_A], 0, 'no counter movement anywhere');
});

Deno.test('dispatchDeclineOffer: declining twice is refused and creates no extra offer', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A)] });

  const first = await callHandler(dispatchDeclineOffer, RIDER_A, { offerId: 'offer-1' });
  expectEqual(first.status, 200, 'first decline succeeds');
  const offerCountAfterFirst = state.offers().length;

  let secondStatus = 0;
  try {
    const second = await callHandler(dispatchDeclineOffer, RIDER_A, { offerId: 'offer-1' });
    secondStatus = second.status;
  } catch (error) {
    secondStatus = (error as { status?: number }).status ?? 0;
  }

  expectEqual(secondStatus, 409, 'the second decline is refused');
  expectEqual(state.offers().length, offerCountAfterFirst, 'no extra offer from the retried decline');
  expectEqual(state.load[RIDER_A], 0, 'no counter movement');
});

// ---------------------------------------------------------------------------
// 6. EXPIRY -> RE-OFFER, via the queue-drainer sweep, and its idempotence.
// ---------------------------------------------------------------------------

Deno.test('sweepDispatchOffers: an expired offer is re-offered to the next rider', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A, 'offer-1', -1000)] });

  const result = await sweepDispatchOffers();

  expectEqual(result.expired, 1, 'one offer expired');
  expectEqual(result.reoffered, 1, 'one order re-offered');
  expectEqual(state.offers()[0]?.status, 'expired', 'the overdue offer is expired');
  expectEqual(state.offers()[1]?.courierId, RIDER_B, 'the re-offer excluded the rider who let it lapse');
  expectEqual(state.load[RIDER_A], 0, 'expiry touches no counter');
  expectEqual(state.load[RIDER_B], 0, 'the re-offer touches no counter');
});

Deno.test('sweepDispatchOffers: running repeatedly expires each offer exactly once and creates no duplicates', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A, 'offer-1', -1000)] });

  const first = await sweepDispatchOffers();
  const second = await sweepDispatchOffers();
  const third = await sweepDispatchOffers();

  expectEqual(first.expired, 1, 'the first sweep expires the overdue offer');
  expectEqual(second.expired, 0, 'the second sweep finds nothing due');
  expectEqual(third.expired, 0, 'the third sweep finds nothing due');

  // The re-offer from sweep 1 is still live, so sweeps 2 and 3 must not
  // stack another offer on top of it.
  expectEqual(state.offers().length, 2, 'exactly two offers exist after three sweeps');
  expectEqual(second.reoffered, 0, 'no duplicate re-offer while one is outstanding');
  expectEqual(third.reoffered, 0, 'still no duplicate re-offer');
  expectEqual(state.load[RIDER_A], 0, 'no counter movement across three sweeps');
  expectEqual(state.load[RIDER_B], 0, 'no counter movement across three sweeps');
});

// ---------------------------------------------------------------------------
// 7. EXHAUSTION -> the manual queue.
// ---------------------------------------------------------------------------

Deno.test('dispatchDeclineOffer: after the pool is walked out the order falls back to manual with no claim anywhere', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A)] });

  // Rider A declines -> re-offered to B. B declines -> nobody left.
  await callHandler(dispatchDeclineOffer, RIDER_A, { offerId: 'offer-1' });
  expectEqual(state.offers().length, 2, 're-offered to the second rider');

  // The re-offer's id comes from the mock's generic (orderId, sequence) form.
  await callHandler(dispatchDeclineOffer, RIDER_B, { offerId: `offer-${ORDER_ID}-2` });

  expectEqual(state.offers().length, 2, 'no third offer - there is nobody left to ask');
  expectEqual(state.offers()[0]?.status, 'declined', 'first offer declined');
  expectEqual(state.offers()[1]?.status, 'declined', 'second offer declined');

  const exhaustion = state.tables.DeliveryEvent.rows.filter(
    (row) => row.eventType === 'dispatch_offers_exhausted'
  );
  expectEqual(exhaustion.length, 1, 'exactly one exhaustion event - admin paged once');

  // The order is now an ordinary manual-queue order and, critically, no rider
  // is carrying a phantom claim for it.
  expectEqual(state.assignment(), null, 'no assignment was ever created');
  expectEqual(state.load[RIDER_A], 0, 'rider A carries no claim');
  expectEqual(state.load[RIDER_B], 0, 'rider B carries no claim');
});

// ---------------------------------------------------------------------------
// 8. REVIEW FIXES.
// ---------------------------------------------------------------------------

// I-2: an order that exhausted EARLY (every rider excluded, fewer than
// MAX_DISPATCH_OFFERS offers made) used to satisfy the candidate predicate
// forever. Combined with oldest-first ordering and the batch limit, enough of
// them starve the sweep: they occupy the whole batch every minute and no
// newly-expired offer is ever re-offered again.
Deno.test('sweepDispatchOffers: an exhausted order stops being a re-offer candidate', async () => {
  const state = installMocks('accepted', {
    offers: [{ ...pendingOffer(RIDER_A, 'offer-1'), status: 'declined' }],
    riders: [RIDER_A],
    // The exhaustion marker recordDispatchOffersExhausted writes once per order.
    events: [{ eventType: 'dispatch_offers_exhausted', id: 'ev-1', orderId: ORDER_ID }],
  });

  const first = await sweepDispatchOffers();
  const second = await sweepDispatchOffers();

  expectEqual(first.reoffered, 0, 'an exhausted order is not re-offered');
  expectEqual(first.skipped, 0, 'and is not even a candidate - not merely skipped');
  expectEqual(second.reoffered, 0, 'still not a candidate on a later sweep');
  expectEqual(state.offers().length, 1, 'no new offer row was created');
});

Deno.test('sweepDispatchOffers: exhausted orders do not crowd a live order out of the batch', async () => {
  // Two exhausted orders with the OLDEST offeredAt timestamps, plus one
  // genuinely live order whose offer just lapsed. Under the old predicate the
  // two exhausted ones were permanent candidates sorted ahead of the live one;
  // this test pins that they are excluded so the live order is reached.
  const old1 = new Date(Date.now() - 3_600_000).toISOString();
  const old2 = new Date(Date.now() - 3_000_000).toISOString();

  const state = installMocks('accepted', {
    // ORDER_ID is the live one: its offer lapsed and should be re-offered.
    offers: [{ ...pendingOffer(RIDER_A, 'offer-1', -1000), offeredAt: new Date().toISOString() }],
    riders: [RIDER_A, RIDER_B],
    extraOrders: [
      { id: 'order-stuck-1', status: 'accepted' },
      { id: 'order-stuck-2', status: 'accepted' },
    ],
    extraOffers: [
      { courierId: RIDER_A, id: 'stuck-1-a', offeredAt: old1, orderId: 'order-stuck-1', respondedAt: old1, respondsBy: old1, sequence: 1, status: 'declined' },
      { courierId: RIDER_B, id: 'stuck-1-b', offeredAt: old1, orderId: 'order-stuck-1', respondedAt: old1, respondsBy: old1, sequence: 2, status: 'declined' },
      { courierId: RIDER_A, id: 'stuck-2-a', offeredAt: old2, orderId: 'order-stuck-2', respondedAt: old2, respondsBy: old2, sequence: 1, status: 'declined' },
      { courierId: RIDER_B, id: 'stuck-2-b', offeredAt: old2, orderId: 'order-stuck-2', respondedAt: old2, respondsBy: old2, sequence: 2, status: 'declined' },
    ],
    events: [
      { eventType: 'dispatch_offers_exhausted', id: 'ev-1', orderId: 'order-stuck-1' },
      { eventType: 'dispatch_offers_exhausted', id: 'ev-2', orderId: 'order-stuck-2' },
    ],
  });

  const result = await sweepDispatchOffers();

  expectEqual(result.expired, 1, "only the live order's offer was due");
  expectEqual(result.reoffered, 1, 'the live order WAS reached and re-offered');

  const reoffers = state.offers().filter((row) => row.orderId === ORDER_ID && row.status === 'pending');
  expectEqual(reoffers.length, 1, 'the live order has a fresh pending offer');
  expectEqual(reoffers[0]?.courierId, RIDER_B, 'the re-offer excluded the rider who let it lapse');

  // The stuck orders were left entirely alone.
  expectEqual(state.offers().filter((row) => row.orderId === 'order-stuck-1').length, 2, 'stuck order 1 untouched');
  expectEqual(state.offers().filter((row) => row.orderId === 'order-stuck-2').length, 2, 'stuck order 2 untouched');
  expectEqual(state.load[RIDER_A], 0, 'no counter movement');
  expectEqual(state.load[RIDER_B], 0, 'no counter movement');
});

// The sweep's end-to-end path for a lapsed offer.
//
// NOT the M-1 regression test, despite an earlier version of this comment
// claiming so: the sweep's pass 1 expires the row before any re-offer is
// attempted, so this never exercises the lapsed-while-still-PENDING state
// M-1 is about. A mutation check proved it - reverting the M-1 fix left this
// green. The real M-1 test drives a status transition instead and lives in
// dispatchSelection.test.ts.
Deno.test('sweepDispatchOffers: a lapsed offer is expired and re-offered in one pass', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_A, 'offer-1', -1000)] });

  // Rider B declining is not what unblocks this - there is no offer for B.
  // Drive selection directly through the decline path of the LAPSED rider's
  // order by running the sweep's re-offer entry point.
  const result = await sweepDispatchOffers();

  expectEqual(result.reoffered, 1, 'the lapsed offer did not block the re-offer');
  expectEqual(state.offers()[0]?.status, 'expired', 'the lapsed offer was expired');
  expectEqual(state.offers()[1]?.courierId, RIDER_B, 'a fresh offer went to the next rider');
  expectEqual(state.load[RIDER_A], 0, 'no counter movement');
});

// I-1: an exhausted order has NO dispatch owner by definition, and
// getDispatchAssignmentOwnerId returns '' for a missing assignment row, which
// matches no uid. Before isUnownedDispatchableOrder existed, that meant an
// exhausted order was visible to admins only and every dispatcher was 403'd
// from assigning it - so with no admin on shift, nobody holding the dispatch
// role could see or act on it at all.

const dispatchGetDeliveryQueue = dispatchDomain.handlers.dispatchGetDeliveryQueue;
if (typeof dispatchGetDeliveryQueue !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchGetDeliveryQueue is not registered.');
}

const dispatchAssignOrderCourier = dispatchDomain.handlers.dispatchAssignOrderCourier;
if (typeof dispatchAssignOrderCourier !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchAssignOrderCourier is not registered.');
}

const readJson = async (response: Response) => (await response.json()) as {
  data?: { orders?: Array<{ id?: string }>; offers?: unknown[] };
};

Deno.test('dispatchGetDeliveryQueue: an exhausted, owner-less order is visible to a plain dispatcher', async () => {
  const state = installMocks('accepted', {
    offers: [
      { ...pendingOffer(RIDER_A, 'offer-1'), status: 'declined' },
      { ...pendingOffer(RIDER_B, 'offer-2'), sequence: 2, status: 'declined' },
    ],
    events: [{ eventType: 'dispatch_offers_exhausted', id: 'ev-1', orderId: ORDER_ID }],
  });

  // No DeliveryAssignment row at all - the defining shape of exhaustion.
  expectEqual(state.assignment(), null, 'precondition: the order has no assignment');

  const response = await dispatchGetDeliveryQueue({
    context: riderContext(RIDER_A),
    data: {},
    request: fakeRequest(),
  });

  const body = await readJson(response);
  const ids = (body.data?.orders ?? []).map((order) => order.id);
  expectEqual(ids.includes(ORDER_ID), true, 'the exhausted order appears in a dispatcher queue');
});

Deno.test('dispatchAssignOrderCourier: a plain dispatcher can manually place a rider on an exhausted order', async () => {
  const state = installMocks('accepted', {
    offers: [
      { ...pendingOffer(RIDER_A, 'offer-1'), status: 'declined' },
      { ...pendingOffer(RIDER_B, 'offer-2'), sequence: 2, status: 'declined' },
    ],
    events: [{ eventType: 'dispatch_offers_exhausted', id: 'ev-1', orderId: ORDER_ID }],
  });

  const response = await dispatchAssignOrderCourier({
    context: riderContext(RIDER_A),
    data: { courierId: RIDER_A, orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'the manual assignment is permitted, not 403d');
  expectEqual(state.assignment()?.courierId, RIDER_A, 'the rider is now on the order');
  expectEqual(state.load[RIDER_A], 1, 'the manual path claims exactly once');
});

// M-3: a manual assignment used to leave an outstanding pending offer alone,
// so the offered rider kept a live-looking countdown for work already given
// to somebody else. Ledger-safe (a pending offer carries no claim) but wrong.
//
// Driven as an ADMIN override (review round 2). An order under a LIVE pending
// offer has no exhaustion marker and is therefore NOT in the manual queue, so
// a plain dispatcher is now correctly 403'd from grabbing it (that was Defect
// 1). The only actor who can manually assign over a live offer is an admin, so
// that is the path this M-3 behaviour is legitimately reachable through - and
// the supersede must still fire on it.
Deno.test('dispatchAssignOrderCourier: a manual (admin) assignment supersedes any still-pending offer', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_B, 'offer-1')] });

  const response = await dispatchAssignOrderCourier({
    context: adminContext('admin-1'),
    data: { courierId: RIDER_A, orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'the manual assignment succeeds');
  expectEqual(state.offers()[0]?.status, 'superseded', "the other rider's live offer is closed out");
  expectEqual(state.assignment()?.courierId, RIDER_A, 'the manually assigned rider holds the order');
  expectEqual(state.load[RIDER_A], 1, 'the assigned rider is incremented exactly once');
  // The superseded rider never had a claim, so nothing to release.
  expectEqual(state.load[RIDER_B], 0, 'the superseded rider carries no claim');
});

// The same ownership widening applies to dispatchGetOrderDetail: an order a
// dispatcher can see in their queue must also open. Covered separately from
// the assign handler because the two share identical guard text, which is
// exactly why a mutation aimed at one silently landed on the other.
const dispatchGetOrderDetail = dispatchDomain.handlers.dispatchGetOrderDetail;
if (typeof dispatchGetOrderDetail !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchGetOrderDetail is not registered.');
}

Deno.test('dispatchGetOrderDetail: a plain dispatcher can open an exhausted, owner-less order', async () => {
  installMocks('accepted', {
    offers: [
      { ...pendingOffer(RIDER_A, 'offer-1'), status: 'declined' },
      { ...pendingOffer(RIDER_B, 'offer-2'), sequence: 2, status: 'declined' },
    ],
    events: [{ eventType: 'dispatch_offers_exhausted', id: 'ev-1', orderId: ORDER_ID }],
  });

  const response = await dispatchGetOrderDetail({
    context: riderContext(RIDER_A),
    data: { orderId: ORDER_ID },
    request: fakeRequest(),
  });

  expectEqual(response.status, 200, 'the detail view opens rather than 403ing');
});

// ---------------------------------------------------------------------------
// 9. REVIEW FIX ROUND 2.
// ---------------------------------------------------------------------------

const dispatchUpdateOrderStatus = dispatchDomain.handlers.dispatchUpdateOrderStatus;
if (typeof dispatchUpdateOrderStatus !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchUpdateOrderStatus is not registered.');
}

const statusOf = (response: unknown): number => {
  if (response && typeof response === 'object' && 'status' in response) {
    return (response as { status: number }).status;
  }
  return 0;
};

const callSafely = async (
  // deno-lint-ignore no-explicit-any
  handler: any,
  ctx: unknown,
  data: Record<string, unknown>
): Promise<number> => {
  try {
    return statusOf(await handler({ context: ctx, data, request: fakeRequest() }));
  } catch (error) {
    return (error as { status?: number }).status ?? 0;
  }
};

// Defect 1 (Important): the round-1 exhaustion-visibility fix keyed only off
// "no assignment row", but an order under a LIVE 45s offer to a specific rider
// ALSO has no assignment row (the claim is not created until accept). So a
// plain dispatcher could see, open, and self-assign an order that was live
// offered to somebody else, superseding the offeree's exclusive window. The
// narrowed predicate requires the order to be in the manual queue (exhausted,
// no live offer); mutating that gate reddens the first assertion of each block.
Deno.test('Defect 1: an order under a live pending offer to another rider is hidden from and unassignable by a plain dispatcher', async () => {
  const state = installMocks('accepted', { offers: [pendingOffer(RIDER_B, 'offer-1')] });
  expectEqual(state.assignment(), null, 'precondition: an actively-offered order has no assignment row');

  // Queue: the order is RIDER_B's to answer, so RIDER_A must not see it.
  const queue = await dispatchGetDeliveryQueue({ context: riderContext(RIDER_A), data: {}, request: fakeRequest() });
  const ids = (await readJson(queue)).data?.orders?.map((order) => order.id) ?? [];
  expectEqual(ids.includes(ORDER_ID), false, 'the live-offered order is NOT in RIDER_A\'s queue');

  // Detail: opening it would leak the delivery address and the customer phone.
  expectEqual(
    await callSafely(dispatchGetOrderDetail, riderContext(RIDER_A), { orderId: ORDER_ID }),
    403,
    'RIDER_A cannot open the live-offered order'
  );

  // Self-assign: RIDER_A must not be able to supersede RIDER_B's window.
  expectEqual(
    await callSafely(dispatchAssignOrderCourier, riderContext(RIDER_A), { courierId: RIDER_A, orderId: ORDER_ID }),
    403,
    'RIDER_A cannot self-assign the live-offered order'
  );
  expectEqual(state.offers()[0]?.status, 'pending', "RIDER_B's offer is untouched - still live");
  expectEqual(state.assignment(), null, 'no assignment was created by the refused self-assign');
  expectEqual(state.load[RIDER_A], 0, 'no claim landed');
});

Deno.test('Defect 1: the same order becomes visible, openable and assignable once auto-offer is exhausted', async () => {
  const state = installMocks('accepted', {
    offers: [{ ...pendingOffer(RIDER_B, 'offer-1'), status: 'declined' }],
    events: [{ eventType: 'dispatch_offers_exhausted', id: 'ev-1', orderId: ORDER_ID }],
  });

  const queue = await dispatchGetDeliveryQueue({ context: riderContext(RIDER_A), data: {}, request: fakeRequest() });
  const ids = (await readJson(queue)).data?.orders?.map((order) => order.id) ?? [];
  expectEqual(ids.includes(ORDER_ID), true, 'the exhausted order appears in RIDER_A\'s queue');

  const detail = await dispatchGetOrderDetail({ context: riderContext(RIDER_A), data: { orderId: ORDER_ID }, request: fakeRequest() });
  expectEqual(detail.status, 200, 'RIDER_A can open the exhausted order');

  const assign = await dispatchAssignOrderCourier({
    context: riderContext(RIDER_A),
    data: { courierId: RIDER_A, orderId: ORDER_ID },
    request: fakeRequest(),
  });
  expectEqual(assign.status, 200, 'RIDER_A can self-assign the exhausted order');
  expectEqual(state.assignment()?.courierId, RIDER_A, 'RIDER_A now holds it');
  expectEqual(state.load[RIDER_A], 1, 'exactly one claim landed');
});

// Airtightness of the manual-queue gate's second conjunct: an order that
// exhausted EARLY still gets a fresh offer once a new rider comes online, so a
// dispatch_offers_exhausted marker and a live offer can coexist. While the
// offeree owns the clock the order must stay out of the manual queue - the
// marker alone is not enough. Mutating loadManualQueueOrderIds to drop the
// no-live-offer filter reddens this.
Deno.test('Defect 1: a marker plus a live re-offer to a fresh rider is still not grabbable from the manual queue', async () => {
  const state = installMocks('accepted', {
    offers: [pendingOffer(RIDER_B, 'offer-1')],
    events: [{ eventType: 'dispatch_offers_exhausted', id: 'ev-1', orderId: ORDER_ID }],
  });

  const queue = await dispatchGetDeliveryQueue({ context: riderContext(RIDER_A), data: {}, request: fakeRequest() });
  const ids = (await readJson(queue)).data?.orders?.map((order) => order.id) ?? [];
  expectEqual(ids.includes(ORDER_ID), false, 'marker + a live offer is still not manual-queue work');

  expectEqual(
    await callSafely(dispatchAssignOrderCourier, riderContext(RIDER_A), { courierId: RIDER_A, orderId: ORDER_ID }),
    403,
    'RIDER_A still cannot grab it while RIDER_B has the clock'
  );
});

// Defect 2 (Important): round 1 deliberately did not widen
// dispatchUpdateOrderStatus, because its transitions need a courier an unowned
// order lacks - but `escalate` needs no courier, and it is the most useful
// action on a rider-less stuck order. So the escalate button (enabled on the
// detail screen from status alone) 403'd on exactly the orders round 1 rescued.
// Only escalate is widened; every courier-requiring transition stays 403.
Deno.test('Defect 2: a plain dispatcher can escalate an unowned exhausted order but cannot drive a courier-requiring transition', async () => {
  const state = installMocks('accepted', {
    offers: [{ ...pendingOffer(RIDER_B, 'offer-1'), status: 'declined' }],
    events: [{ eventType: 'dispatch_offers_exhausted', id: 'ev-1', orderId: ORDER_ID }],
  });

  // picked_up needs a rider the unowned order does not have: still 403,
  // refused at the ownership gate before the status window is even consulted.
  expectEqual(
    await callSafely(dispatchUpdateOrderStatus, riderContext(RIDER_A), { action: 'picked_up', orderId: ORDER_ID }),
    403,
    'picked_up on an unowned order is refused - there is no courier to have picked up'
  );
  expectEqual(state.order()?.status, 'accepted', 'the refused transition changed nothing');

  // escalate needs no courier, so it is the one action the rescue path allows.
  const escalate = await dispatchUpdateOrderStatus({
    context: riderContext(RIDER_A),
    data: { action: 'escalate', orderId: ORDER_ID },
    request: fakeRequest(),
  });
  expectEqual(escalate.status, 200, 'escalate on the unowned exhausted order is allowed');
  expectEqual(state.order()?.status, 'escalated', 'the order is now escalated for manual intervention');
  expectEqual(state.load[RIDER_A], 0, 'escalation touches no counter');
});

// And escalate is NOT a bypass: an order still inside a live offer window is
// not in the manual queue, so a plain dispatcher cannot escalate it either.
Deno.test('Defect 2: escalate is refused on an order still under a live offer', async () => {
  installMocks('accepted', { offers: [pendingOffer(RIDER_B, 'offer-1')] });

  expectEqual(
    await callSafely(dispatchUpdateOrderStatus, riderContext(RIDER_A), { action: 'escalate', orderId: ORDER_ID }),
    403,
    'escalate is gated on the manual queue too - a live-offered order is off-limits'
  );
});
