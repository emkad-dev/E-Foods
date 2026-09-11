// Regression tests for the BEST-EFFORT discipline around
// `captureOrderPlacementRiskSignals` inside the REAL `placeCustomerOrder`
// handler.
//
// The defect these guard against: risk capture runs AFTER the CustomerOrder
// row and its `order_placed` audit entry are written. It reads CustomerOrder
// through `loadRecentCustomerOrders` (_shared/riskSignals.ts), which converts
// any PostgREST error into a `throw`. Before the try/catch, an ordinary
// transient database blip on that read failed the whole placement RPC for an
// order that ALREADY EXISTED -- the customer is told placement failed, retries,
// and places a duplicate; on a prepaid method they pay twice.
//
// Same harness shape and rationale as placeCustomerOrderAvailability.test.ts /
// orderModifiers.test.ts: the domain modules statically import
// `_shared/client.ts`, which throws at module-evaluation time without
// SUPABASE_URL / SERVICE_ROLE_KEY set first, so those are set BEFORE the
// dynamic import, and the REAL handler is pulled out of
// `ordersDomain.handlers`. Mocks return snapshots (plain objects captured at
// call time), never live references the handler could mutate out from under an
// assertion.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');
const originalRiskSignalsFrom = serviceClient.from.bind(serviceClient);
const originalRiskSignalsRpc = serviceClient.rpc.bind(serviceClient);
const originalRiskSignalsFetch = globalThis.fetch;

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const handler = ordersDomain.handlers.placeCustomerOrder;
if (typeof handler !== 'function') {
  throw new Error('ordersDomain.handlers.placeCustomerOrder is not registered.');
}

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

const CUSTOMER_CONTEXT = {
  email: 'customer@example.test',
  role: 'customer',
  token: 'fake-token',
  uid: 'customer-uid',
  userProfile: { uid: 'customer-uid', email: 'customer@example.test', role: 'customer', accountDisabled: false },
};

const BASE_ORDER_INPUT = {
  fulfillmentType: 'pickup',
  paymentMethod: 'cash',
  restaurantId: 'restaurant-1',
};

const BASE_ITEM_PRICE = 2000;

// Pricing v2 (_shared/pricing.ts): customer-facing menu price =
// base x (1 + markupRate) + markupFlat per unit, and with no PlatformSettings
// row the mock returns null so DEFAULT_PRICING_CONFIG applies
// (markupRate 0.2, markupFlat 100). One unit at 2000, pickup so no delivery
// fee: 2000 x 1.2 + 100 = 2500. Asserting the literal (rather than
// recomputing it) is the point -- the placement must come back INTACT, not
// merely "not throw".
const EXPECTED_TOTAL = 2500;

const buildRestaurant = () => ({
  id: 'restaurant-1',
  name: 'Test Kitchen',
  isPublished: true,
  isOpen: true,
  supportsDelivery: true,
  supportsPickup: true,
  minOrder: 0,
  deliveryFee: 0,
  pausedUntil: null,
  menu: [{ category: 'Mains', items: [{ id: 'item-1', name: 'Jollof Rice', price: BASE_ITEM_PRICE, isAvailable: true }] }],
});

// RISK_SIGNAL_THRESHOLDS.accountVelocity.medium is 5, so six recent orders in
// the window is what makes `captureOrderPlacementRiskSignals` actually EMIT an
// account_velocity event and reach the RiskEvent write. Anything under the
// threshold produces zero events and the RiskEvent table is never touched --
// which would make the happy-path test assert nothing.
const recentOrdersFixture = () =>
  Array.from({ length: 6 }, (_unused, index) => ({
    createdAt: new Date(Date.now() - (index + 1) * 60 * 1000).toISOString(),
    customerId: CUSTOMER_CONTEXT.uid,
    payment: { deviceSessionId: 'device-session-1' },
    status: 'placed',
    updatedAt: new Date(Date.now() - (index + 1) * 60 * 1000).toISOString(),
  }));

type MockOptions = {
  /** Result the risk-capture `CustomerOrder` read resolves to. */
  customerOrderSelectResult?: { data: unknown; error: { message: string } | null };
  /** Result the `RiskEvent` upsert resolves to. */
  riskEventUpsertResult?: { error: { message: string } | null };
};

/**
 * Installs fresh `serviceClient.from(...)` and `fetch` fakes covering every
 * table this handler's success path touches: RestaurantRecord /
 * RestaurantApproval (loadRestaurantById), PlatformSettings
 * (loadPricingConfig, falls back to defaults on a null row),
 * CustomerOrder / OrderItem / DeliveryEvent (order creation and audit), plus
 * RiskEvent for the capture step these tests are about. PromoCode /
 * PromoRedemption read empty (no code supplied). notifyRestaurantUsers and the
 * confirmation email are wrapped in notifySafely upstream (swallows errors) and
 * RESEND_API_KEY is unset in this test env, so neither needs a mock. An
 * unhandled table throws loudly rather than silently returning empty data.
 */
const installMocks = (options: MockOptions = {}) => {
  const customerOrderSelectResult = options.customerOrderSelectResult ??
    { data: recentOrdersFixture(), error: null };
  const riskEventUpsertResult = options.riskEventUpsertResult ?? { error: null };

  const state = {
    deliveryEvents: [] as unknown[],
    itemInserts: [] as unknown[],
    orderInserts: [] as unknown[],
    riskEventUpserts: [] as unknown[],
  };

  // deno-lint-ignore no-explicit-any
  const emptyQueryBuilder = (): any => {
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lt: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      returns: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'RestaurantRecord') {
      return {
        select: (_columns: string) => ({
          eq: (_column: string, _value: string) => ({
            maybeSingle: () => Promise.resolve({ data: buildRestaurant(), error: null }),
          }),
        }),
      };
    }

    if (table === 'RestaurantApproval' || table === 'PlatformSettings') {
      return {
        select: (_columns: string) => ({
          eq: (_column: string, _value: string) => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    }

    if (table === 'CustomerOrder') {
      return {
        insert: (payload: unknown) => {
          state.orderInserts.push(payload);
          return Promise.resolve({ error: null });
        },
        // The risk-capture read: loadRecentCustomerOrders chains
        // .select().eq().gte().lt().returns() and awaits the builder. Whatever
        // `customerOrderSelectResult` says is what that await sees -- an
        // `error` here is exactly the transient database blip the regression is
        // about, and loadRecentCustomerOrders turns it into a throw.
        select: () => {
          // deno-lint-ignore no-explicit-any
          const builder: any = {
            eq: () => builder,
            gte: () => builder,
            lt: () => builder,
            order: () => builder,
            limit: () => builder,
            returns: () => builder,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            single: () => Promise.resolve({ data: null, error: null }),
            then: (resolve: (value: typeof customerOrderSelectResult) => unknown) =>
              Promise.resolve(customerOrderSelectResult).then(resolve),
          };
          return builder;
        },
      };
    }

    if (table === 'OrderItem') {
      return {
        insert: (payload: unknown) => {
          state.itemInserts.push(payload);
          return Promise.resolve({ error: null });
        },
      };
    }

    if (table === 'DeliveryEvent') {
      return {
        insert: (payload: unknown) => {
          state.deliveryEvents.push(payload);
          return Promise.resolve({ error: null });
        },
      };
    }

    if (table === 'RiskEvent') {
      return {
        upsert: (payload: unknown, _options?: unknown) => {
          // Snapshot, not the live row the caller still holds.
          state.riskEventUpserts.push(JSON.parse(JSON.stringify(payload)));
          return Promise.resolve(riskEventUpsertResult);
        },
      };
    }

    if (table === 'PromoCode' || table === 'PromoRedemption') {
      return emptyQueryBuilder();
    }

    // notifyRestaurantUsers runs after the response is assembled and is wrapped
    // in notifySafely (swallows everything), so it cannot affect these
    // assertions -- but reading empty keeps the test output free of
    // "Notification dispatch failed" noise that would obscure the real signal.
    if (table === 'UserRole' || table === 'PushToken' || table === 'UserDevice' || table === 'UserAccount') {
      return emptyQueryBuilder();
    }

    throw new Error(`placeCustomerOrderRiskSignals.test.ts: unexpected table "${table}"`);
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

const placeOrder = async (data: Record<string, unknown> = {}) =>
  // deno-lint-ignore no-explicit-any
  await (handler as any)({
    context: CUSTOMER_CONTEXT,
    data: { ...BASE_ORDER_INPUT, items: [{ id: 'item-1', quantity: 1 }], ...data },
    request: fakeRequest(),
  });

/** Runs `body` with console.error captured, returning the captured lines. */
const captureConsoleErrors = async <T>(body: () => Promise<T>): Promise<{ lines: string[]; result: T }> => {
  const lines: string[] = [];
  const originalConsoleError = console.error;
  // deno-lint-ignore no-explicit-any
  console.error = (...args: any[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '));
  };

  try {
    const result = await body();
    return { lines, result };
  } finally {
    console.error = originalConsoleError;
  }
};

/**
 * Asserts the handler responded with a SUCCESSFUL, INTACT placement -- not
 * merely that it did not throw. A regression that swallowed the risk failure
 * but returned a mangled/absent body would still be the same customer-facing
 * bug.
 */
const expectSuccessfulPlacement = async (response: Response, label: string) => {
  expectEqual(response.status, 200, `${label}: HTTP status`);
  const body = await response.json();
  expectEqual(typeof body?.data?.orderId, 'string', `${label}: response carries an orderId`);
  expectEqual((body?.data?.orderId ?? '').length > 0, true, `${label}: orderId is non-empty`);
  expectEqual(body?.data?.status, 'placed', `${label}: landed order status`);
  expectEqual(body?.data?.total, EXPECTED_TOTAL, `${label}: order total`);
  expectEqual(body?.data?.paymentStatus, 'pending', `${label}: payment status`);
  return body.data as { orderId: string; status: string; total: number };
};

// --- 1. The read inside risk capture fails ---------------------------------
//
// THE test. `loadRecentCustomerOrders` throws on a PostgREST error, and the
// order row plus its audit entry are already written by this point. Without the
// try/catch in placeCustomerOrder this rejects and the customer is told an
// order that exists failed to place.
Deno.test('placeCustomerOrder: a failed CustomerOrder read inside risk capture does NOT fail the placement', async () => {
  const state = installMocks({
    customerOrderSelectResult: { data: null, error: { message: 'canceling statement due to statement timeout' } },
  });

  const response = await placeOrder();

  const data = await expectSuccessfulPlacement(response, 'risk-capture read failure');
  // The order really was written before risk capture ran -- which is precisely
  // why throwing here was so damaging.
  expectEqual(state.orderInserts.length, 1, 'exactly one CustomerOrder insert');
  expectEqual(state.deliveryEvents.length, 1, 'the order_placed audit entry was written');
  expectEqual(typeof data.orderId, 'string', 'the caller gets back the id of the order that exists');
});

// --- 2. The RiskEvent write fails ------------------------------------------
//
// Defence in depth. NOTE (honest scoping): this one passes with or without the
// try/catch in placeCustomerOrder, because the write path is already doubly
// guarded -- `recordRiskEvent` (_shared/riskEvents.ts) try/catches the upsert
// AND returns null on a PostgREST error, and `writeRiskEvents`
// (_shared/riskSignals.ts) try/catches each recordRiskEvent call on top.
// It is kept because those two guards are the thing that makes the claim true,
// and nothing else asserts they hold from the placement's point of view: if
// either is ever removed, this test catches it.
Deno.test('placeCustomerOrder: a failed RiskEvent write does NOT fail the placement', async () => {
  const state = installMocks({
    riskEventUpsertResult: { error: { message: 'remaining connection slots are reserved' } },
  });

  const { result } = await captureConsoleErrors(() => placeOrder());

  await expectSuccessfulPlacement(result, 'risk-event write failure');
  expectEqual(state.orderInserts.length, 1, 'exactly one CustomerOrder insert');
  expectEqual(state.riskEventUpserts.length > 0, true, 'the RiskEvent write was actually attempted');
});

// --- 3. The happy path still captures signals ------------------------------
//
// Proves the try/catch did not silently disable the feature: with nothing
// failing, an account_velocity RiskEvent is still written.
Deno.test('placeCustomerOrder: risk signals are still captured when nothing fails', async () => {
  const state = installMocks();

  const response = await placeOrder();

  const data = await expectSuccessfulPlacement(response, 'happy path');
  expectEqual(state.riskEventUpserts.length, 1, 'exactly one RiskEvent written');

  const riskEvent = state.riskEventUpserts[0] as Record<string, unknown>;
  expectEqual(riskEvent.eventType, 'account_velocity', 'captured event type');
  expectEqual(riskEvent.subjectType, 'account', 'captured subject type');
  expectEqual(riskEvent.subjectId, CUSTOMER_CONTEXT.uid, 'captured subject id');
  expectEqual(riskEvent.severity, 'medium', 'six orders in the hour is medium (threshold 5)');
  expectEqual(riskEvent.score, 6, 'score is the order count in the window');
  expectEqual(riskEvent.orderId, data.orderId, 'the captured event points at the order just placed');
});

// --- 4. The failure is logged, not swallowed silently ----------------------
//
// logEdgeEvent('error', ...) (_shared/observability.ts) writes a JSON payload
// to console.error, so capturing console.error is enough to prove the swallow
// is observable. A silent catch would leave operators blind to exactly the
// transient-database condition the change is designed to survive.
Deno.test('placeCustomerOrder: a swallowed risk-capture failure is logged with the order id', async () => {
  installMocks({
    customerOrderSelectResult: { data: null, error: { message: 'canceling statement due to statement timeout' } },
  });

  const { lines, result } = await captureConsoleErrors(() => placeOrder());

  const data = await expectSuccessfulPlacement(result, 'logged risk-capture failure');

  const logLine = lines.find((line) => line.includes('order placement risk signal capture failed'));
  expectEqual(
    Boolean(logLine),
    true,
    `expected a logged risk-capture failure, got console.error lines: ${JSON.stringify(lines)}`
  );

  const payload = JSON.parse(logLine as string) as Record<string, unknown>;
  expectEqual(payload.level, 'error', 'log level');
  expectEqual(payload.message, 'order placement risk signal capture failed', 'log message');
  expectEqual(payload.orderId, data.orderId, 'the log names the order that was placed anyway');
  expectEqual(
    String(payload.error).includes('canceling statement due to statement timeout'),
    true,
    `the underlying database error is preserved in the log, got: ${JSON.stringify(payload.error)}`
  );
});

Deno.test('placeCustomerOrderRiskSignals cleanup: restore shared client and fetch', () => {
  // Keep later files on the real client and fetch implementation.
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalRiskSignalsFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalRiskSignalsRpc;
  globalThis.fetch = originalRiskSignalsFetch;
});
