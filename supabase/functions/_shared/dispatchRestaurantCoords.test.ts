// Rider trip map: the rider's own ASSIGNED, in-flight orders carry the
// restaurant's coordinates (pickup pin + turn-by-turn), and nothing else does.
// Offers, redacted manual-queue snapshots, other riders' orders, terminal
// orders and admin reads must never get them - a pre-acceptance rider has no
// business learning where a kitchen is beyond what the offer already shows.
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

// No test here may touch the network (realtime broadcasts, push, email).
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;

const expect = (cond: boolean, label: string) => {
  if (!cond) throw new Error(label);
};

const getQueue = dispatchDomain.handlers.dispatchGetDeliveryQueue;
const getDetail = dispatchDomain.handlers.dispatchGetOrderDetail;
if (typeof getQueue !== 'function' || typeof getDetail !== 'function') {
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

const baseOrder = (id: string, restaurantId: string, status: string) => ({
  id,
  customerId: `cust-${id}`,
  restaurantId,
  restaurantName: `Kitchen ${restaurantId}`,
  status,
  fulfillmentType: 'delivery',
  pricing: { total: 4300 },
  payment: { method: 'card', status: 'paid', reference: `ref_${id}` },
  deliveryAddress: `15 Secret Lane (${id})`,
  deliveryLocation: { latitude: 6.512345, longitude: 3.378912 },
  cancellation: null,
  timeline: null,
  needsAttention: false,
  scheduledFor: null,
  orderGroupId: null,
  createdAt: '2026-10-15T10:00:00Z',
  updatedAt: '2026-10-15T10:00:00Z',
});

// rider-a owns four: two in flight at DIFFERENT restaurants, a second order at
// rest-own-1 (so the batched lookup must de-duplicate ids), and a delivered
// one. rider-b owns one (never visible to rider-a).
const OWN_PICKUP = baseOrder('own-pickup', 'rest-own-1', 'ready_for_pickup');
const OWN_ENROUTE = baseOrder('own-enroute', 'rest-own-2', 'on_the_way');
const OWN_SECOND_SAME_KITCHEN = baseOrder('own-second', 'rest-own-1', 'accepted');
const OWN_DELIVERED = baseOrder('own-delivered', 'rest-terminal', 'delivered');
// Unowned, exhausted into the manual queue: redacted for rider-a. A 'platform'
// order so the global rider-a may take it.
const MANUAL = {
  ...baseOrder('manual', 'rest-manual', 'ready_for_pickup'),
  pricing: { total: 4300, deliveryProvider: 'platform' },
};
const OTHERS = baseOrder('others', 'rest-other', 'on_the_way');
// Reached only through a live offer to rider-a.
const OFFERED = baseOrder('offered', 'rest-offer', 'ready_for_pickup');

const assignmentFor = (orderId: string, riderId: string) => ({
  orderId,
  dispatchId: riderId,
  dispatchOwnerId: riderId,
  courierId: riderId,
  courierName: riderId,
  assignedAt: '2026-10-15T10:05:00Z',
});
const ASSIGNMENTS = [
  assignmentFor('own-pickup', 'rider-a'),
  assignmentFor('own-enroute', 'rider-a'),
  assignmentFor('own-second', 'rider-a'),
  assignmentFor('own-delivered', 'rider-a'),
  assignmentFor('others', 'rider-b'),
];

const OFFER = {
  id: 'offer-1',
  orderId: 'offered',
  courierId: 'rider-a',
  status: 'pending',
  offeredAt: new Date().toISOString(),
  respondsBy: new Date(Date.now() + 45_000).toISOString(),
  respondedAt: null,
  sequence: 1,
};

const RESTAURANTS: Record<string, { id: string; latitude: number | null; longitude: number | null }> = {
  'rest-own-1': { id: 'rest-own-1', latitude: 6.601, longitude: 3.301 },
  'rest-own-2': { id: 'rest-own-2', latitude: 6.702, longitude: 3.402 },
  'rest-terminal': { id: 'rest-terminal', latitude: 6.9, longitude: 3.9 },
  'rest-manual': { id: 'rest-manual', latitude: 6.803, longitude: 3.503 },
  'rest-other': { id: 'rest-other', latitude: 6.804, longitude: 3.504 },
  'rest-offer': { id: 'rest-offer', latitude: 6.805, longitude: 3.505 },
};

const ALL_ORDERS = [OWN_PICKUP, OWN_ENROUTE, OWN_SECOND_SAME_KITCHEN, OWN_DELIVERED, MANUAL, OTHERS, OFFERED];

type Recorded = { restaurantReads: Array<{ ids: string[] }> };

const installMocks = (opts: { restaurantReadFails?: boolean } = {}): Recorded => {
  const recorded: Recorded = { restaurantReads: [] };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let inValues: unknown[] | null = null;

    const rowsFor = (): Record<string, unknown>[] => {
      switch (table) {
        case 'CustomerOrder': {
          // The queue's list read (fulfillmentType filter) returns everything
          // EXCEPT the offered order, which has no assignment and must reach
          // rider-a through the offer path only. The offer path reads by id list.
          if (typeof filters.id === 'string') return ALL_ORDERS.filter((o) => o.id === filters.id);
          if (inValues) return ALL_ORDERS.filter((o) => inValues!.includes(o.id));
          return 'fulfillmentType' in filters ? ALL_ORDERS.filter((o) => o.id !== 'offered') : [];
        }
        case 'DeliveryAssignment':
          return ASSIGNMENTS.filter(
            (row) =>
              (typeof filters.orderId !== 'string' || row.orderId === filters.orderId) &&
              (!inValues || inValues.includes(row.orderId))
          );
        case 'DeliveryOffer':
          return [OFFER];
        case 'DeliveryEvent':
          // The exhaustion marker that puts the manual order in the manual queue.
          if (filters.eventType === 'dispatch_offers_exhausted') {
            return [{ orderId: 'manual' }].filter((row) => !inValues || inValues.includes(row.orderId));
          }
          return [];
        case 'UserRole':
          // Every dispatch caller here is a global FEASTY rider.
          return typeof filters.userId === 'string' && filters.role === 'dispatch' ? [{ restaurantId: null }] : [];
        case 'RestaurantRecord':
          if (typeof filters.id === 'string') return RESTAURANTS[filters.id] ? [RESTAURANTS[filters.id]] : [];
          return (inValues ?? []).map((id) => RESTAURANTS[String(id)]).filter(Boolean);
        default:
          // OrderItem, UserAccount (customer phone) ... - nothing to return.
          return [];
      }
    };

    // Records every restaurant read and, when asked, makes it fail.
    const restaurantFailure = () => {
      if (table !== 'RestaurantRecord') return null;
      recorded.restaurantReads.push({
        ids: inValues ? inValues.map(String) : typeof filters.id === 'string' ? [filters.id] : [],
      });
      return opts.restaurantReadFails ? { data: null, error: { message: 'restaurant read exploded' } } : null;
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      neq: () => builder,
      limit: () => builder,
      gte: () => builder,
      lte: () => builder,
      is: () => builder,
      in: (_column: string, values: unknown[]) => {
        inValues = values;
        return builder;
      },
      maybeSingle: async () => restaurantFailure() ?? { data: rowsFor()[0] ?? null, error: null },
      single: async () => ({ data: rowsFor()[0] ?? null, error: null }),
      // deno-lint-ignore no-explicit-any
      then: (resolve: any, reject: any) =>
        Promise.resolve(restaurantFailure() ?? { data: rowsFor(), error: null }).then(resolve, reject),
    };
    return builder;
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async () => ({ data: null, error: null });

  return recorded;
};

const queueFor = async (role: string, uid: string) => {
  const res = await getQueue({ context: ctx(role, uid), data: {}, request: fakeRequest() } as never);
  return (await res.json()).data as {
    offers: Array<{ order: Record<string, unknown> }>;
    orders: Array<Record<string, unknown>>;
  };
};

const find = (orders: Array<Record<string, unknown>>, id: string) => {
  const order = orders.find((o) => o.id === id);
  if (!order) throw new Error(`order ${id} missing from the queue`);
  return order;
};

Deno.test('queue: the caller own in-flight orders carry restaurant coordinates', async () => {
  installMocks();
  const { orders } = await queueFor('dispatch', 'rider-a');
  const pickup = find(orders, 'own-pickup');
  expect(pickup.restaurantLatitude === 6.601 && pickup.restaurantLongitude === 3.301, 'pickup order gets coords');
  const enroute = find(orders, 'own-enroute');
  expect(enroute.restaurantLatitude === 6.702 && enroute.restaurantLongitude === 3.402, 'en-route order gets coords');
  const second = find(orders, 'own-second');
  expect(second.restaurantLatitude === 6.601, 'a second order at the same kitchen gets coords too');
});

Deno.test('queue: ONE batched read over the distinct own, unredacted, non-terminal restaurant ids', async () => {
  const recorded = installMocks();
  await queueFor('dispatch', 'rider-a');
  expect(recorded.restaurantReads.length === 1, `expected 1 restaurant read, got ${recorded.restaurantReads.length}`);
  const ids = [...recorded.restaurantReads[0].ids].sort();
  expect(
    JSON.stringify(ids) === JSON.stringify(['rest-own-1', 'rest-own-2']),
    `only own in-flight restaurants may be read, got ${JSON.stringify(ids)}`
  );
});

Deno.test('queue: redacted manual-queue, terminal and offer snapshots carry NO restaurant coordinates', async () => {
  installMocks();
  const { orders, offers } = await queueFor('dispatch', 'rider-a');

  const manual = find(orders, 'manual');
  expect(!('deliveryAddress' in manual), 'sanity: the manual-queue snapshot is the redacted one');
  expect(manual.restaurantLatitude == null && manual.restaurantLongitude == null, 'manual snapshot has no coords');
  expect(!JSON.stringify(manual).includes('6.803'), 'manual restaurant latitude appears nowhere');

  const delivered = find(orders, 'own-delivered');
  expect(
    delivered.restaurantLatitude == null && delivered.restaurantLongitude == null,
    'a terminal order gets no coords'
  );

  expect(offers.length === 1, `expected 1 offer, got ${offers.length}`);
  const offerOrder = offers[0].order;
  expect(offerOrder.restaurantLatitude == null && offerOrder.restaurantLongitude == null, 'offer snapshot has no coords');
  expect(!JSON.stringify(offers).includes('6.805'), 'offer restaurant latitude appears nowhere');

  expect(!orders.some((o) => o.id === 'others'), 'sanity: another rider order is not in this rider queue');
});

Deno.test('queue: no restaurant read at all when the caller owns nothing in flight', async () => {
  const recorded = installMocks();
  const { orders } = await queueFor('dispatch', 'rider-nobody');
  // rider-nobody is also global, so the manual order is visible (redacted).
  expect(orders.some((o) => o.id === 'manual'), 'sanity: manual order visible');
  expect(recorded.restaurantReads.length === 0, 'the restaurant query must be skipped for an empty id set');
});

Deno.test('queue: admin reads get no restaurant coordinates', async () => {
  const recorded = installMocks();
  const { orders } = await queueFor('admin', 'admin-1');
  expect(orders.every((o) => o.restaurantLatitude == null), 'admin snapshots carry no coords');
  expect(recorded.restaurantReads.length === 0, 'no restaurant read for admin');
});

Deno.test('queue: a failing restaurant read degrades to null coords, not a failed queue', async () => {
  installMocks({ restaurantReadFails: true });
  const { orders } = await queueFor('dispatch', 'rider-a');
  const pickup = find(orders, 'own-pickup');
  expect(pickup.restaurantLatitude == null && pickup.restaurantLongitude == null, 'null coords on failure');
  expect(pickup.deliveryAddress === '15 Secret Lane (own-pickup)', 'the rest of the snapshot still arrives');
});

Deno.test('detail: the owner of an in-flight order gets restaurant coordinates', async () => {
  installMocks();
  const res = await getDetail({
    context: ctx('dispatch', 'rider-a'),
    data: { orderId: 'own-pickup' },
    request: fakeRequest(),
  } as never);
  const order = (await res.json()).data.order as Record<string, unknown>;
  expect(order.restaurantLatitude === 6.601 && order.restaurantLongitude === 3.301, 'owner detail carries coords');
});

Deno.test('detail: a non-owner opening a manual-queue order gets the redacted snapshot with no coordinates', async () => {
  const recorded = installMocks();
  const res = await getDetail({
    context: ctx('dispatch', 'rider-b'),
    data: { orderId: 'manual' },
    request: fakeRequest(),
  } as never);
  const order = (await res.json()).data.order as Record<string, unknown>;
  expect(!('deliveryAddress' in order), 'sanity: the redacted snapshot');
  expect(order.restaurantLatitude == null && order.restaurantLongitude == null, 'no coords on the redacted detail');
  expect(recorded.restaurantReads.length === 0, 'the restaurant is not even looked up for a non-owner');
});
