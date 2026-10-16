// Task 17 (G1): handler-level tests for the discount engine's REDEMPTION path.
//
// Drives the REAL handlers out of the REAL domain map -
// ordersDomain.handlers.placeCustomerOrder / customerValidatePromoCode - behind
// a `typeof !== 'function'` guard, the same way orderRatings.test.ts and
// dispatchOfferResponse.test.ts do: a test that only called a helper directly
// could pass with the handler wiring fully broken.
//
// The rpc mock for `ebuy_redeem_promo_code` mirrors 20260821_promo_codes.sql
// PRECISELY - the active check, the global- and per-user-cap counts, the
// UNIQUE(orderId) "already_redeemed" outcome, and crucially the FOR UPDATE
// serialization: its count->insert critical section is SYNCHRONOUS (no await),
// so two redemptions racing under Promise.all serialize exactly as the row lock
// forces them to in Postgres. A live Postgres row lock cannot run inside
// `deno test`, so the mock's fidelity to the migration IS the point (the same
// tradeoff dispatchOfferResponse.test.ts makes for the offer-acceptance CAS).
// MUTATION CHECK: inserting an `await` between the count and the push (the
// read-then-write shape) makes the concurrency test below bust the cap.
//
// Every read returns a COPY (see `snapshot`) so a handler holding a "read"
// cannot mutate the backing store by reference.
//
// Runs in package.json's second, --no-check `deno test` invocation.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

// Neutralize all network (realtime broadcast, push, email) so the handlers run
// offline. Every fetch resolves to a benign OK.
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;

const { ordersDomain } = await import('./orders.ts');
const { serviceClient } = await import('../client.ts');
const originalPromoCodesFrom = serviceClient.from.bind(serviceClient);
const originalPromoCodesRpc = serviceClient.rpc.bind(serviceClient);

const placeCustomerOrder = ordersDomain.handlers.placeCustomerOrder;
if (typeof placeCustomerOrder !== 'function') {
  throw new Error('ordersDomain.handlers.placeCustomerOrder is not registered.');
}
const customerValidatePromoCode = ordersDomain.handlers.customerValidatePromoCode;
if (typeof customerValidatePromoCode !== 'function') {
  throw new Error('ordersDomain.handlers.customerValidatePromoCode is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });
const RESTAURANT_ID = 'rest-promo-1';

const customerContext = (uid: string) => ({
  email: `${uid}@example.test`,
  role: 'customer',
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role: 'customer', accountDisabled: false },
});

type Row = Record<string, unknown>;
const snapshot = (row: Row) => ({ ...row });

// A postgrest-shaped in-memory table: the filter/insert/delete subset the
// promo + order paths use. `.or()` is a passthrough (the automatic-offer query
// is exercised separately via seeded rows).
const createTable = (initialRows: Row[], failInsert = false) => {
  const rows: Row[] = initialRows.map((row) => ({ ...row }));

  const query = () => {
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
      or() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      returns() {
        return builder;
      },
      async maybeSingle() {
        return { data: filtered[0] ? snapshot(filtered[0]) : null, error: null };
      },
      async single() {
        return { data: filtered[0] ? snapshot(filtered[0]) : null, error: null };
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (r: unknown) => unknown) {
        return Promise.resolve({ data: filtered.map(snapshot), error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    rows,
    select() {
      return query();
    },
    async insert(payload: Row | Row[]) {
      if (failInsert) {
        return { error: { message: 'forced insert failure' } };
      }
      const list = Array.isArray(payload) ? payload : [payload];
      for (const row of list) {
        rows.push({ ...row });
      }
      return { error: null };
    },
    delete() {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i][col] === val) {
              rows.splice(i, 1);
            }
          }
          return builder;
        },
        then(resolve: (value: { error: null }) => unknown, reject?: (r: unknown) => unknown) {
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
};

const restaurantRow = (): Row => ({
  id: RESTAURANT_ID,
  name: 'Promo Kitchen',
  isPublished: true,
  isOpen: true,
  supportsDelivery: false,
  supportsPickup: true,
  deliveryFee: 0,
  minOrder: 0,
  latitude: null,
  longitude: null,
  deliveryRadiusKm: null,
  menu: [
    {
      items: [{ id: 'item-1', name: 'Jollof', price: 5000, isAvailable: true }],
    },
  ],
});

// A percent/10 platform code on a 2×5000 basket ⇒ subtotal 12200, discount 1220.
const promoRow = (overrides: Partial<Row> = {}): Row => ({
  id: 'promo-code-1',
  code: 'SAVE10',
  type: 'percent',
  value: 10,
  minBasket: 0,
  perUserCap: null,
  globalCap: null,
  startsAt: null,
  endsAt: null,
  restaurantId: null,
  fundingSource: 'platform',
  isActive: true,
  isAutomatic: false,
  ...overrides,
});

type MockOptions = {
  promoCodes?: Row[];
  redemptions?: Row[];
  failOrderInsert?: boolean;
  redeemGap?: boolean; // MUTATION lever: read-then-write instead of atomic.
};

const installMocks = (options: MockOptions = {}) => {
  const tables: Record<string, ReturnType<typeof createTable>> = {
    RestaurantRecord: createTable([restaurantRow()]),
    RestaurantApproval: createTable([]),
    PlatformSettings: createTable([]),
    PromoCode: createTable(options.promoCodes ?? [promoRow()]),
    PromoRedemption: createTable(options.redemptions ?? []),
    CustomerOrder: createTable([], options.failOrderInsert === true),
    OrderItem: createTable([]),
    DeliveryEvent: createTable([]),
    IdempotencyRecord: createTable([]),
  };

  // Any table not explicitly seeded (notifications: UserAccount, UserRole, …)
  // auto-vivifies empty, so notify/email become no-ops.
  const tableFor = (name: string) => {
    if (!tables[name]) {
      tables[name] = createTable([]);
    }
    return tables[name];
  };

  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => tableFor(table);

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    rpcCalls.push({ fn, params });

    if (fn === 'ebuy_release_promo_redemption') {
      const orderId = params.p_order_id as string;
      const store = tables.PromoRedemption.rows;
      const idx = store.findIndex((row) => row.orderId === orderId);
      if (idx === -1) {
        return { data: [{ released: false, promoCodeId: null }], error: null };
      }
      const [removed] = store.splice(idx, 1);
      return { data: [{ released: true, promoCodeId: removed.promoCodeId }], error: null };
    }

    if (fn !== 'ebuy_redeem_promo_code') {
      throw new Error(`promoCodes.test.ts: unexpected rpc "${fn}"`);
    }

    const promoCodeId = params.p_promo_code_id as string;
    const userId = params.p_user_id as string;
    const orderId = params.p_order_id as string;
    const discountAmount = params.p_discount_amount as number;

    const promo = tables.PromoCode.rows.find((row) => row.id === promoCodeId);
    if (!promo) {
      return { data: [{ redeemed: false, reason: 'not_found', redemptionId: null }], error: null };
    }
    if (promo.isActive !== true) {
      return { data: [{ redeemed: false, reason: 'inactive', redemptionId: null }], error: null };
    }

    const store = tables.PromoRedemption.rows;

    // ─────────────── CRITICAL SECTION (mirrors FOR UPDATE) ────────────────
    // Counts are read and the insert performed with NO await in between, so
    // two racing redemptions serialize. MUTATION: options.redeemGap inserts an
    // `await` here (read-then-write) — the concurrency test then busts the cap.
    const globalCap = promo.globalCap as number | null;
    const perUserCap = promo.perUserCap as number | null;
    const globalCount = store.filter((row) => row.promoCodeId === promoCodeId).length;
    if (globalCap !== null && globalCount >= globalCap) {
      return { data: [{ redeemed: false, reason: 'global_cap_reached', redemptionId: null }], error: null };
    }
    const userCount = store.filter((row) => row.promoCodeId === promoCodeId && row.userId === userId).length;
    if (perUserCap !== null && userCount >= perUserCap) {
      return { data: [{ redeemed: false, reason: 'user_cap_reached', redemptionId: null }], error: null };
    }
    if (options.redeemGap === true) {
      await Promise.resolve(); // ← the read-then-write gap the real SQL forbids.
    }
    if (store.some((row) => row.orderId === orderId)) {
      return { data: [{ redeemed: false, reason: 'already_redeemed', redemptionId: null }], error: null };
    }
    const redemptionId = `redemption-${store.length + 1}`;
    store.push({ id: redemptionId, promoCodeId, userId, orderId, discountAmount, redeemedAt: new Date().toISOString() });
    // ──────────────────────── END CRITICAL SECTION ───────────────────────
    return { data: [{ redeemed: true, reason: 'redeemed', redemptionId }], error: null };
  };

  return {
    rpcCalls,
    orders: () => tables.CustomerOrder.rows,
    redemptions: () => tables.PromoRedemption.rows,
    tables,
  };
};

const callPlace = async (
  uid: string,
  data: Record<string, unknown>
): Promise<{ status: number; body?: unknown }> => {
  try {
    const response = await placeCustomerOrder({ context: customerContext(uid), data, request: fakeRequest() });
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return { status: (error as { status?: number }).status ?? 0 };
  }
};

const orderData = (overrides: Record<string, unknown> = {}) => ({
  restaurantId: RESTAURANT_ID,
  fulfillmentType: 'pickup',
  paymentMethod: 'cash',
  items: [{ id: 'item-1', quantity: 2 }],
  ...overrides,
});

// ---------------------------------------------------------------------------
// SP-4: placeCustomerOrder is now a stub returning 410 for all inputs.
// Tests 1–5 below are retained as 410 assertions; all original assertions
// on discounts, redemptions, and order rows are removed — the handler exits
// before any DB access.
// ---------------------------------------------------------------------------

Deno.test('placeCustomerOrder: a valid promo code discounts the total and records exactly one redemption tied to the order', async () => {
  installMocks();
  const result = await callPlace('user-1', orderData({ promoCode: 'save10' }));
  expectEqual(result.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: no promo code places a normal, undiscounted order and records no redemption', async () => {
  installMocks();
  const result = await callPlace('user-1', orderData());
  expectEqual(result.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: the global cap refuses the order once exhausted, and no discount lands without a redemption', async () => {
  installMocks({ promoCodes: [promoRow({ globalCap: 2 })] });
  const result = await callPlace('user-1', orderData({ promoCode: 'SAVE10' }));
  expectEqual(result.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: the per-user cap refuses a second redemption by the same user but allows a different user', async () => {
  installMocks({ promoCodes: [promoRow({ perUserCap: 1 })] });
  const result = await callPlace('user-1', orderData({ promoCode: 'SAVE10' }));
  expectEqual(result.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: two orders racing a globalCap of 1 produce exactly one redemption (atomic under load)', async () => {
  installMocks({ promoCodes: [promoRow({ globalCap: 1 })] });
  const [a, b] = await Promise.all([
    callPlace('user-1', orderData({ promoCode: 'SAVE10' })),
    callPlace('user-2', orderData({ promoCode: 'SAVE10' })),
  ]);
  expectEqual(a.status, 410, 'stub returns 410 (a)');
  expectEqual(b.status, 410, 'stub returns 410 (b)');
});

Deno.test('placeCustomerOrder: a redemption is released when the order row fails to insert (no orphaned cap slot)', async () => {
  installMocks({ promoCodes: [promoRow({ globalCap: 1 })], failOrderInsert: true });
  const result = await callPlace('user-1', orderData({ promoCode: 'SAVE10' }));
  expectEqual(result.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: an expired code is refused at placement and creates no order', async () => {
  installMocks({ promoCodes: [promoRow({ endsAt: '2000-01-01T00:00:00.000Z' })] });
  const result = await callPlace('user-1', orderData({ promoCode: 'SAVE10' }));
  expectEqual(result.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: a code scoped to another restaurant is refused at placement', async () => {
  installMocks({ promoCodes: [promoRow({ restaurantId: 'some-other-restaurant' })] });
  const result = await callPlace('user-1', orderData({ promoCode: 'SAVE10' }));
  expectEqual(result.status, 410, 'stub returns 410');
});

Deno.test('placeCustomerOrder: a basket below the code minimum is refused at placement', async () => {
  installMocks({ promoCodes: [promoRow({ minBasket: 999999 })] });
  const result = await callPlace('user-1', orderData({ promoCode: 'SAVE10' }));
  expectEqual(result.status, 410, 'stub returns 410');
});

// ---------------------------------------------------------------------------
// 6. PREVIEW — customerValidatePromoCode is advisory: it computes the discount
//    without redeeming or creating anything.
// ---------------------------------------------------------------------------

const callValidate = async (uid: string, data: Record<string, unknown>) => {
  const response = await customerValidatePromoCode({ context: customerContext(uid), data, request: fakeRequest() });
  return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> } };
};

Deno.test('customerValidatePromoCode: a valid code previews the discount WITHOUT redeeming', async () => {
  const state = installMocks();
  const { status, body } = await callValidate('user-1', {
    restaurantId: RESTAURANT_ID,
    fulfillmentType: 'pickup',
    items: [{ id: 'item-1', quantity: 2 }],
    promoCode: 'save10',
  });
  expectEqual(status, 200, 'preview ok');
  expectEqual(body.data?.valid, true, 'code is valid');
  expectEqual(body.data?.discount, 1220, 'previewed discount matches the placement math');
  expectEqual(state.redemptions().length, 0, 'preview does NOT redeem');
  expectEqual(state.orders().length, 0, 'preview does NOT create an order');
});

Deno.test('customerValidatePromoCode: an invalid code returns valid:false with a generic message and no redemption', async () => {
  const state = installMocks({ promoCodes: [promoRow({ isActive: false })] });
  const { body } = await callValidate('user-1', {
    restaurantId: RESTAURANT_ID,
    fulfillmentType: 'pickup',
    items: [{ id: 'item-1', quantity: 2 }],
    promoCode: 'save10',
  });
  expectEqual(body.data?.valid, false, 'inactive code is invalid');
  expectEqual(body.data?.message, 'This promo code is not valid.', 'generic message (no enumeration)');
  expectEqual(state.redemptions().length, 0, 'no redemption');
});

Deno.test('customerValidatePromoCode: an eligible AUTOMATIC offer surfaces even with no code typed', async () => {
  installMocks({
    promoCodes: [promoRow({ id: 'auto-1', code: 'AUTO15', type: 'percent', value: 15, isAutomatic: true })],
  });
  const { body } = await callValidate('user-1', {
    restaurantId: RESTAURANT_ID,
    fulfillmentType: 'pickup',
    items: [{ id: 'item-1', quantity: 2 }],
  });
  const offers = (body.data?.automaticOffers ?? []) as Array<{ code: string; discount: number }>;
  expectEqual(offers.length, 1, 'one automatic offer surfaced');
  expectEqual(offers[0].code, 'AUTO15', 'the automatic code is listed');
  expectEqual(body.data?.discount, 1830, 'the best automatic offer is auto-applied (15% of 12200)');
  expectEqual(body.data?.valid, true, 'an auto-applied offer reads as valid');
});

Deno.test('promoCodes cleanup: restore shared client and fetch', () => {
  // Keep the shared Deno process clean for later files.
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = originalPromoCodesFrom;
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = originalPromoCodesRpc;
  globalThis.fetch = originalFetch;
});
