// Rider-side authorization on the dispatch domain (Play closed-testing pass):
//
// 1. dispatchAssignOrderCourier: a dispatch-role caller may only assign
//    THEMSELVES - never push an order onto another rider.
// 2. Unowned manual-queue orders are visible to every dispatcher, so both the
//    queue and the detail read return them redacted like a pending offer (no
//    customer address / id / phone / payment detail) until a rider takes one;
//    an order the caller owns stays full.
// 3. dispatchRiderSOS never fails for a missing rider record, only links the
//    alert to an order the caller is actually the courier on, and is rate
//    limited per rider (it emails + pushes every admin).
// 4. Missing notifications: the customer hears when a rider accepts their
//    delivery offer, and the carrying rider hears when an admin cancels an
//    escalated order through the dispatch flow.
//
// Calls the REAL handlers out of dispatchDomain.handlers. Env stubs must be set
// before the dynamic import (client.ts throws at module scope without them).
// Runs in package.json's second, --no-check `deno test` invocation because
// dispatch.ts carries pre-existing baseline type errors.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./domains/dispatch.ts');
const { serviceClient } = await import('./client.ts');

// No test here may touch the network (realtime broadcasts, Expo push, email):
// an unreachable endpoint turns into minutes of retries.
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;

const expect = (cond: boolean, label: string) => {
  if (!cond) throw new Error(label);
};

const assign = dispatchDomain.handlers.dispatchAssignOrderCourier;
const acceptOffer = dispatchDomain.handlers.dispatchAcceptOffer;
const updateStatus = dispatchDomain.handlers.dispatchUpdateOrderStatus;
const getQueue = dispatchDomain.handlers.dispatchGetDeliveryQueue;
const getDetail = dispatchDomain.handlers.dispatchGetOrderDetail;
const sos = dispatchDomain.handlers.dispatchRiderSOS;
if (
  typeof assign !== 'function' ||
  typeof getQueue !== 'function' ||
  typeof getDetail !== 'function' ||
  typeof sos !== 'function'
) {
  throw new Error('dispatch handlers are not registered.');
}

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });
const ctx = (role: string, uid: string) => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

const baseOrder = (id: string) => ({
  id,
  customerId: `cust-${id}`,
  restaurantId: 'rest-1',
  restaurantName: 'Mama Put',
  status: 'ready_for_pickup',
  fulfillmentType: 'delivery',
  pricing: { total: 4300 },
  payment: { method: 'card', status: 'paid', reference: `ref_${id}` },
  deliveryAddress: `15 Secret Lane (${id})`,
  deliveryLocation: { latitude: 6.512345, longitude: 3.378912, note: 'Blue gate' },
  cancellation: null,
  timeline: null,
  needsAttention: false,
  scheduledFor: null,
  orderGroupId: null,
  createdAt: '2026-10-15T10:00:00Z',
  updatedAt: '2026-10-15T10:00:00Z',
});

// order-owned: rider-a holds it. order-manual: exhausted, no owner, no courier.
const OWNED = baseOrder('order-owned');
const MANUAL = baseOrder('order-manual');
const ESCALATED = {
  ...baseOrder('order-escalated'),
  status: 'escalated',
  timeline: { escalatedAt: '2026-10-15T10:30:00Z', escalatedFrom: 'on_the_way' },
};
const ESCALATED_ASSIGNMENT = {
  orderId: 'order-escalated',
  dispatchId: 'rider-a',
  dispatchOwnerId: 'rider-a',
  courierId: 'rider-a',
  courierName: 'Ada',
  assignedAt: '2026-10-15T10:05:00Z',
};
const OWNED_ASSIGNMENT = {
  orderId: 'order-owned',
  dispatchId: 'rider-a',
  dispatchOwnerId: 'rider-a',
  courierId: 'rider-a',
  courierName: 'Ada',
  assignedAt: '2026-10-15T10:05:00Z',
};

type Recorded = {
  tablesTouched: string[];
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  // Every id-list / id filter a query carried, by table. Push recipients are
  // asserted through this (the push-token lookup is queried with the
  // recipient user ids) so the test does not depend on notifications.ts
  // internals beyond "it looks up the recipient".
  idFilters: Array<{ table: string; values: unknown[] }>;
  rpcCalls: string[];
  rateLimitKeys: string[];
};

type Fixture = {
  rateLimited?: boolean;
  liveLocation?: { latitude: number; longitude: number } | null;
  riderRecord?: { latitude: number; longitude: number } | null;
  sosAssignmentCourierId?: string | null;
};

const installMocks = (fixture: Fixture = {}): Recorded => {
  const recorded: Recorded = { tablesTouched: [], inserts: [], idFilters: [], rpcCalls: [], rateLimitKeys: [] };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    recorded.tablesTouched.push(table);
    const filters: Record<string, unknown> = {};
    let inValues: unknown[] | null = null;

    const rowsFor = (): Record<string, unknown>[] => {
      switch (table) {
        case 'CustomerOrder': {
          const all = [OWNED, MANUAL, ESCALATED];
          if (typeof filters.id === 'string') return all.filter((o) => o.id === filters.id);
          if (inValues) return all.filter((o) => inValues!.includes(o.id));
          return all;
        }
        case 'DeliveryAssignment':
          if (typeof filters.orderId === 'string' && fixture.sosAssignmentCourierId !== undefined) {
            return fixture.sosAssignmentCourierId === null
              ? []
              : [{ ...OWNED_ASSIGNMENT, orderId: filters.orderId, courierId: fixture.sosAssignmentCourierId }];
          }
          return [OWNED_ASSIGNMENT, ESCALATED_ASSIGNMENT].filter(
            (row) =>
              (typeof filters.orderId !== 'string' || row.orderId === filters.orderId) &&
              (!inValues || inValues.includes(row.orderId))
          );
        case 'DeliveryEvent':
          // The exhaustion marker that puts order-manual in the manual queue.
          if (filters.eventType === 'dispatch_offers_exhausted') {
            return [{ orderId: 'order-manual' }].filter((row) => !inValues || inValues.includes(row.orderId));
          }
          return [];
        case 'rider_live_location':
          return fixture.liveLocation ? [{ rider_id: 'rider-a', ...fixture.liveLocation }] : [];
        case 'DispatchRiderRecord':
          return fixture.riderRecord ? [{ id: 'rider-a', ...fixture.riderRecord }] : [];
        default:
          // DeliveryOffer, OrderItem, UserAccount (admin recipients, phone
          // lookups) ... - nothing to return in these scenarios.
          return [];
      }
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        recorded.idFilters.push({ table, values: [value] });
        return builder;
      },
      neq: () => builder,
      limit: () => builder,
      gte: () => builder,
      lte: () => builder,
      is: () => builder,
      update: () => builder,
      upsert: async () => ({ data: null, error: null }),
      in: (_column: string, values: unknown[]) => {
        inValues = values;
        recorded.idFilters.push({ table, values });
        return builder;
      },
      insert: async (payload: Record<string, unknown>) => {
        recorded.inserts.push({ table, payload });
        return { data: null, error: null };
      },
      maybeSingle: async () => ({ data: rowsFor()[0] ?? null, error: null }),
      single: async () => ({ data: rowsFor()[0] ?? null, error: null }),
      // deno-lint-ignore no-explicit-any
      then: (resolve: any, reject: any) => Promise.resolve({ data: rowsFor(), error: null }).then(resolve, reject),
    };
    return builder;
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (name: string, params: Record<string, unknown> = {}) => {
    recorded.rpcCalls.push(name);
    if (name === 'auth_rl_hit') {
      recorded.rateLimitKeys.push(String(params.p_key));
      return { data: [{ allowed: !fixture.rateLimited }], error: null };
    }
    if (name === 'ebuy_accept_dispatch_offer') {
      return { data: [{ accepted: true, orderId: 'order-owned', reason: null }], error: null };
    }
    return { data: null, error: null };
  };

  return recorded;
};

const statusOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { status?: unknown }).status ?? String(error);
  }
};

// --- 1. self-assignment only ---------------------------------------------------

Deno.test('dispatch rider cannot assign an order to ANOTHER rider (403, before any read)', async () => {
  const recorded = installMocks();
  const status = await statusOf(() =>
    assign({
      context: ctx('dispatch', 'rider-a'),
      data: { courierId: 'rider-b', orderId: 'order-owned' },
      request: fakeRequest(),
    } as never)
  );
  expect(status === 403, `expected 403, got ${JSON.stringify(status)}`);
  expect(recorded.tablesTouched.length === 0, 'the refusal must happen before touching the database');
});

Deno.test('dispatch rider assigning THEMSELVES passes the self-assignment gate', async () => {
  installMocks();
  const status = await statusOf(() =>
    assign({
      context: ctx('dispatch', 'rider-a'),
      data: { courierId: 'rider-a', orderId: 'order-owned' },
      request: fakeRequest(),
    } as never)
  );
  // Whatever happens further down (the mocks do not model the reassignment
  // RPC), it must not be the self-assignment refusal.
  expect(status !== 403, `self-assignment must not be refused with 403, got ${JSON.stringify(status)}`);
});

// --- 2. manual-queue redaction -------------------------------------------------

Deno.test('queue: unowned manual-queue order is redacted, the caller own order is full', async () => {
  installMocks();
  const res = await getQueue({ context: ctx('dispatch', 'rider-a'), data: {}, request: fakeRequest() } as never);
  const body = await res.json();
  const orders = body.data.orders as Array<Record<string, unknown>>;
  const owned = orders.find((o) => o.id === 'order-owned');
  const manual = orders.find((o) => o.id === 'order-manual');
  expect(Boolean(owned), 'own order must be in the queue');
  expect(Boolean(manual), 'manual-queue order must be in the queue');
  expect(owned!.deliveryAddress === '15 Secret Lane (order-owned)', 'own order keeps the address');
  expect(owned!.customerId === 'cust-order-owned', 'own order keeps the customer id');
  expect(!('deliveryAddress' in manual!), 'manual-queue order must not carry the address');
  expect(!('customerId' in manual!), 'manual-queue order must not carry the customer id');
  expect(JSON.stringify(manual!.payment) === '{"status":"paid"}', 'manual-queue payment reduced to status');
  expect(
    (manual!.deliveryLocation as { latitude: number }).latitude === 6.512,
    'manual-queue location must be coarsened'
  );
  expect(!JSON.stringify(manual).includes('Secret Lane'), 'address must appear nowhere in the manual-queue row');
  expect(!JSON.stringify(manual).includes('Blue gate'), 'drop-off note must not leak either');
});

Deno.test('queue: admin still receives full snapshots', async () => {
  installMocks();
  const res = await getQueue({ context: ctx('admin', 'admin-1'), data: {}, request: fakeRequest() } as never);
  const orders = (await res.json()).data.orders as Array<Record<string, unknown>>;
  const manual = orders.find((o) => o.id === 'order-manual');
  expect(manual?.deliveryAddress === '15 Secret Lane (order-manual)', 'admin sees the full address');
});

Deno.test('detail: a non-owner opening a manual-queue order gets it redacted, with no phone lookup', async () => {
  const recorded = installMocks();
  const res = await getDetail({
    context: ctx('dispatch', 'rider-b'),
    data: { orderId: 'order-manual' },
    request: fakeRequest(),
  } as never);
  const order = (await res.json()).data.order as Record<string, unknown>;
  expect(!('deliveryAddress' in order), 'address must be stripped');
  expect(!('customerPhone' in order), 'phone must be stripped');
  expect(!('customerId' in order), 'customer id must be stripped');
  expect(!recorded.tablesTouched.includes('UserAccount'), 'the customer phone must not even be looked up');
});

Deno.test('detail: the owner gets the full order', async () => {
  installMocks();
  const res = await getDetail({
    context: ctx('dispatch', 'rider-a'),
    data: { orderId: 'order-owned' },
    request: fakeRequest(),
  } as never);
  const order = (await res.json()).data.order as Record<string, unknown>;
  expect(order.deliveryAddress === '15 Secret Lane (order-owned)', 'owner sees the address');
  expect(order.customerId === 'cust-order-owned', 'owner sees the customer id');
});

// --- 3. SOS robustness + order scoping -------------------------------------------

Deno.test('SOS succeeds even with no rider record and no live location', async () => {
  const recorded = installMocks({ liveLocation: null, riderRecord: null });
  const res = await sos({
    context: ctx('dispatch', 'rider-a'),
    data: {},
    request: fakeRequest(),
  } as never);
  expect(res.status === 200, `SOS must succeed, got ${res.status}`);
  expect(recorded.inserts.length === 0, 'no order id -> no delivery event');
});

Deno.test('SOS on an order the caller is NOT the courier on writes no delivery event', async () => {
  const recorded = installMocks({ liveLocation: { latitude: 6.5, longitude: 3.3 }, sosAssignmentCourierId: 'rider-b' });
  const res = await sos({
    context: ctx('dispatch', 'rider-a'),
    data: { orderId: 'someone-elses-order' },
    request: fakeRequest(),
  } as never);
  expect(res.status === 200, `SOS must still succeed, got ${res.status}`);
  expect(
    !recorded.inserts.some((entry) => entry.table === 'DeliveryEvent'),
    'must not write into another rider order log'
  );
});

Deno.test('SOS on the caller own order records the event with the LIVE position', async () => {
  const recorded = installMocks({
    liveLocation: { latitude: 6.5, longitude: 3.3 },
    riderRecord: { latitude: 9.9, longitude: 9.9 },
    sosAssignmentCourierId: 'rider-a',
  });
  const res = await sos({
    context: ctx('dispatch', 'rider-a'),
    data: { orderId: 'order-owned' },
    request: fakeRequest(),
  } as never);
  expect(res.status === 200, `SOS must succeed, got ${res.status}`);
  const event = recorded.inserts.find((entry) => entry.table === 'DeliveryEvent');
  expect(Boolean(event), 'a sos_triggered event must be written');
  expect(event!.payload.eventType === 'sos_triggered', 'event type');
  const details = event!.payload.details as { latitude: number; longitude: number };
  expect(details.latitude === 6.5 && details.longitude === 3.3, 'the fresher live position wins over the durable one');
});

Deno.test('SOS is rate limited per rider with a friendly 429, and no admin is alerted', async () => {
  const recorded = installMocks({ rateLimited: true, liveLocation: { latitude: 6.5, longitude: 3.3 } });
  let caught: { status?: unknown; message?: unknown } | null = null;
  try {
    await sos({ context: ctx('dispatch', 'rider-a'), data: {}, request: fakeRequest() } as never);
  } catch (error) {
    caught = error as { status?: unknown; message?: unknown };
  }
  expect(caught?.status === 429, `expected 429, got ${JSON.stringify(caught?.status)}`);
  expect(String(caught?.message).includes('already been sent'), 'the limit message must reassure, not just say slow down');
  expect(
    JSON.stringify(recorded.rateLimitKeys) === JSON.stringify(['dispatch:sos-burst:rider-a']),
    `burst limit checked first, hourly allowance not spent; got ${JSON.stringify(recorded.rateLimitKeys)}`
  );
  expect(!recorded.tablesTouched.includes('UserRole'), 'no admin recipients may be loaded once limited');
});

Deno.test('SOS checks both the burst and the hourly limit when allowed', async () => {
  const recorded = installMocks({ liveLocation: { latitude: 6.5, longitude: 3.3 } });
  const res = await sos({ context: ctx('dispatch', 'rider-a'), data: {}, request: fakeRequest() } as never);
  expect(res.status === 200, `SOS must succeed, got ${res.status}`);
  expect(
    recorded.rateLimitKeys.includes('dispatch:sos-burst:rider-a') &&
      recorded.rateLimitKeys.includes('dispatch:sos-hour:rider-a'),
    `burst + hourly limits; got ${JSON.stringify(recorded.rateLimitKeys)}`
  );
});

// --- 4. missing notifications ----------------------------------------------------

const lookedUpRecipient = (recorded: Recorded, userId: string) =>
  recorded.idFilters.some(
    (entry) =>
      entry.table !== 'CustomerOrder' && entry.table !== 'DeliveryAssignment' && entry.values.includes(userId)
  );

Deno.test('accepting an offer notifies the customer', async () => {
  const recorded = installMocks({ riderRecord: { latitude: 6.5, longitude: 3.3 } });
  const res = await acceptOffer({
    context: ctx('dispatch', 'rider-a'),
    data: { offerId: 'offer-1' },
    request: fakeRequest(),
  } as never);
  expect(res.status === 200, `accept must succeed, got ${res.status}`);
  expect(lookedUpRecipient(recorded, 'cust-order-owned'), 'the customer must be resolved as a push recipient');
});

Deno.test('admin cancel of an escalated order notifies the carrying rider and the customer', async () => {
  const recorded = installMocks();
  const res = await updateStatus({
    context: ctx('admin', 'admin-1'),
    data: { orderId: 'order-escalated', action: 'cancel_escalated' },
    request: fakeRequest(),
  } as never);
  expect(res.status === 200, `cancel must succeed, got ${res.status}`);
  expect(lookedUpRecipient(recorded, 'rider-a'), 'the carrying rider must be resolved as a push recipient');
  expect(lookedUpRecipient(recorded, 'cust-order-escalated'), 'the customer must be resolved as a push recipient');
});
