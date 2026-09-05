// The customer-facing rider-position broadcast: fan-out to active orders and,
// above all, the payload WHITELIST. The customer must receive ONLY the rider's
// coordinates plus a coarse timestamp - never the rider's id, phone, name, or
// anything about another order. This test asserts the emitted payload
// field-by-field, so a mutation that leaks the rider id or phone into the
// payload reddens it.
//
// _shared/client.ts throws at module scope without SUPABASE_URL /
// SERVICE_ROLE_KEY, so the two env vars are set before the module is imported
// dynamically - the same pattern the domain handler tests use. The real
// serviceClient is never touched here: both dependencies (the active-order
// loader and the broadcaster) are injected, so this exercises only the pure
// fan-out + whitelist logic.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { broadcastRiderPositionToActiveOrders } = await import('./riderPositionBroadcast.ts');

const assert = (condition: boolean, label: string) => {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
};

const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

type Emitted = { orderId: string; position: Record<string, unknown> };

Deno.test('broadcastRiderPositionToActiveOrders: the payload is a strict coordinate whitelist', async () => {
  const emitted: Emitted[] = [];

  const orderIds = await broadcastRiderPositionToActiveOrders({
    riderId: 'rider-secret-1',
    latitude: 6.5244,
    longitude: 3.3792,
    updatedAt: '2026-08-20T10:00:00.000Z',
    loadActiveOrderIds: async () => ['order-1'],
    // Snapshot the payload the moment it is emitted (a shallow copy), so a
    // later reference mutation cannot rewrite what we assert against.
    broadcast: (orderId, position) => {
      emitted.push({ orderId, position: { ...(position as Record<string, unknown>) } });
    },
  });

  assertEqual(orderIds.length, 1, 'broadcast to exactly the one active order');
  assertEqual(orderIds[0], 'order-1', 'the returned order id is the active one');
  assertEqual(emitted.length, 1, 'exactly one broadcast emitted');

  const { orderId, position } = emitted[0];
  assertEqual(orderId, 'order-1', 'emitted to the order-1 topic');

  // The whitelist, asserted key-by-key: exactly latitude, longitude, updatedAt.
  const keys = Object.keys(position).sort();
  assertEqual(JSON.stringify(keys), JSON.stringify(['latitude', 'longitude', 'updatedAt']), 'exactly the three whitelisted keys');
  assertEqual(position.latitude, 6.5244, 'latitude value carried through');
  assertEqual(position.longitude, 3.3792, 'longitude value carried through');
  assertEqual(position.updatedAt, '2026-08-20T10:00:00.000Z', 'coarse updatedAt carried through');

  // Nothing that identifies the rider or another order may appear. If the
  // whitelist were reverted to a spread, `riderId` (and friends) would be here.
  for (const forbidden of ['riderId', 'id', 'phone', 'phoneNumber', 'courierId', 'name', 'zone', 'vehicleType', 'accuracy']) {
    assert(!(forbidden in position), `payload must NOT contain "${forbidden}"`);
  }
});

Deno.test('broadcastRiderPositionToActiveOrders: no active orders means no broadcast at all', async () => {
  let broadcasts = 0;

  const orderIds = await broadcastRiderPositionToActiveOrders({
    riderId: 'rider-2',
    latitude: 6.6,
    longitude: 3.3,
    updatedAt: null,
    loadActiveOrderIds: async () => [],
    broadcast: () => {
      broadcasts += 1;
    },
  });

  assertEqual(orderIds.length, 0, 'no order ids returned');
  assertEqual(broadcasts, 0, 'the broadcaster is never called when there are no active orders');
});

Deno.test('broadcastRiderPositionToActiveOrders: fans the same whitelisted payload out to every active order', async () => {
  const emitted: Emitted[] = [];

  await broadcastRiderPositionToActiveOrders({
    riderId: 'rider-3',
    latitude: 7.1,
    longitude: 3.9,
    updatedAt: '2026-08-20T11:22:33.000Z',
    loadActiveOrderIds: async () => ['order-a', 'order-b'],
    broadcast: (orderId, position) => {
      emitted.push({ orderId, position: { ...(position as Record<string, unknown>) } });
    },
  });

  assertEqual(emitted.length, 2, 'one broadcast per active order');
  assertEqual(emitted[0].orderId, 'order-a', 'first order targeted');
  assertEqual(emitted[1].orderId, 'order-b', 'second order targeted');
  for (const { position } of emitted) {
    assertEqual(position.latitude, 7.1, 'same latitude to each order');
    assertEqual(position.longitude, 3.9, 'same longitude to each order');
  }
});
