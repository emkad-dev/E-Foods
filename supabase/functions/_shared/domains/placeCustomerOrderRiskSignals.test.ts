// Originally tested the BEST-EFFORT discipline around
// `captureOrderPlacementRiskSignals` inside `placeCustomerOrder`. SP-4
// (cash removal) stubbed the handler to return 410 immediately, making
// risk-capture code unreachable. Tests below verify the stub behavior.

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

// --- SP-4 stub verification ------------------------------------------------
//
// placeCustomerOrder is now a stub that returns 410 for all inputs. The
// risk-capture path is unreachable. Tests below just confirm the stub behavior.
Deno.test('placeCustomerOrder: stub returns 410 regardless of risk-capture mock state', async () => {
  installMocks({
    customerOrderSelectResult: { data: null, error: { message: 'canceling statement due to statement timeout' } },
  });

  let thrown: unknown = null;
  try {
    await placeOrder();
  } catch (error) {
    thrown = error;
  }

  expectEqual(thrown instanceof Error, true, 'handler should throw');
  expectEqual((thrown as { status?: number })?.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: stub returns 410 with no DB writes', async () => {
  const state = installMocks();

  let thrown: unknown = null;
  try {
    await placeOrder();
  } catch (error) {
    thrown = error;
  }

  expectEqual((thrown as { status?: number })?.status, 410, 'stub returns 410');
  expectEqual(state.orderInserts.length, 0, 'no CustomerOrder insert (stub exits before any DB write)');
  expectEqual(state.deliveryEvents.length, 0, 'no DeliveryEvent insert');
  expectEqual(state.riskEventUpserts.length, 0, 'no RiskEvent write');
});

Deno.test('placeCustomerOrder: stub message is client-safe cash-removal copy', async () => {
  installMocks();

  let thrown: unknown = null;
  try {
    await placeOrder();
  } catch (error) {
    thrown = error;
  }

  expectEqual(
    (thrown as Error)?.message,
    'Cash payments are no longer accepted. Please use card or bank transfer.',
    'rejection message is the client-safe cash-removal copy'
  );
});

// --- dead-code placeholder -------------------------------------------------
//
// The original 4 tests (risk-capture read failure, RiskEvent write failure,
// happy-path signal capture, logged-failure) were removed because the handler
// body they exercised is now dead code. A comment is kept here so reviewers
// know the deletion was intentional and tracked in the SP-4 plan.
Deno.test('placeCustomerOrderRiskSignals: original risk-capture discipline tests removed (SP-4 stub)', () => {
  // no-op — intentional deletion, see docs/superpowers/plans/2026-10-16-dispatch-sp4-cash-removal.md
});

Deno.test('placeCustomerOrderRiskSignals cleanup: restore shared client and fetch', () => {
  // Keep later files on the real client and fetch implementation.
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalRiskSignalsFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalRiskSignalsRpc;
  globalThis.fetch = originalRiskSignalsFetch;
});
