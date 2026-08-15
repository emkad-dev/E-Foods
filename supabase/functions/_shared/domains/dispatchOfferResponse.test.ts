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
    CustomerOrder: createTable([buildOrderRow(orderStatus)]),
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
    DeliveryEvent: createTable([]),
    DeliveryOffer: createTable(options.offers ?? []),
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
  const orderRow = () => tables.CustomerOrder.rows[0];
  const assignmentRow = () => tables.DeliveryAssignment.rows.find((row) => row.orderId === ORDER_ID) ?? null;

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
      const status = normalizeStatus(orderRow()?.status);

      if (!OFFERABLE_STATUSES.includes(status)) {
        return {
          data: [{ offerId: null, offered: false, reason: 'order_not_offerable', sequence: null }],
          error: null,
        };
      }

      if (assignmentRow()?.courierId) {
        return {
          data: [{ offerId: null, offered: false, reason: 'already_assigned', sequence: null }],
          error: null,
        };
      }

      const forOrder = offerRows().filter((row) => row.orderId === ORDER_ID);
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
      const offerId = `offer-${sequence}`;
      offerRows().push({
        courierId,
        id: offerId,
        offeredAt: now,
        orderId: ORDER_ID,
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
      const status = normalizeStatus(orderRow()?.status);
      const forOrder = offerRows().filter((row) => row.orderId === ORDER_ID);
      const eligible =
        OFFERABLE_STATUSES.includes(status) &&
        !assignmentRow()?.courierId &&
        forOrder.length > 0 &&
        !forOrder.some((row) => row.status === 'pending') &&
        forOrder.length < MAX_OFFERS;
      return { data: eligible ? [{ orderId: ORDER_ID }] : [], error: null };
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

  await callHandler(dispatchDeclineOffer, RIDER_B, { offerId: 'offer-2' });

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
