// Tests for the pure join behind the admin Dispatch "On the road now" list.
// orders.ts imports client.ts, which throws at module scope without env, so
// the env vars are set first and the module under test is imported
// dynamically (same pattern as dispatchSelection.test.ts).

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { buildInProgressDeliveries } = await import('./dispatchInProgress.ts');

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e} but got ${a}`);
}

const order = (id: string, status: string, restaurantName: string | null = 'Mama Put') => ({
  id,
  status,
  restaurantName,
  updatedAt: '2026-11-20T10:00:00.000Z',
});
const assignment = (orderId: string, assignedAt: string | null, courierId: string | null = 'c1') => ({
  orderId,
  courierId,
  courierName: courierId ? 'Tunde' : null,
  assignedAt,
});

Deno.test('empty inputs return an empty list', () => {
  assertEquals(buildInProgressDeliveries([], []), []);
  assertEquals(buildInProgressDeliveries([order('o1', 'picked_up')], []), []);
  assertEquals(buildInProgressDeliveries([], [assignment('o1', '2026-11-20T09:00:00.000Z')]), []);
});

Deno.test('terminal statuses are excluded', () => {
  const orders = [
    order('o1', 'delivered'),
    order('o2', 'cancelled'),
    order('o3', 'rejected'),
    order('o4', 'failed_delivery'),
    order('o6', 'picked_up'),
  ];
  const assignments = orders.map((o) => assignment(o.id, '2026-11-20T09:00:00.000Z'));
  const result = buildInProgressDeliveries(orders, assignments);
  assertEquals(result.map((r) => r.orderId), ['o6']);
});

Deno.test('orders without an assignment are excluded', () => {
  const result = buildInProgressDeliveries(
    [order('o1', 'picked_up'), order('o2', 'picked_up')],
    [assignment('o2', '2026-11-20T09:00:00.000Z')],
  );
  assertEquals(result.map((r) => r.orderId), ['o2']);
});

Deno.test('rows are shaped, with a null restaurant name preserved', () => {
  const [row] = buildInProgressDeliveries(
    [order('o1', 'picked_up', null)],
    [assignment('o1', '2026-11-20T09:00:00.000Z')],
  );
  assertEquals(row, {
    orderId: 'o1',
    status: 'picked_up',
    restaurantName: null,
    courierId: 'c1',
    courierName: 'Tunde',
    assignedAt: '2026-11-20T09:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
  });
});

Deno.test('sorted oldest assignedAt first, missing assignedAt last', () => {
  const orders = [order('a', 'picked_up'), order('b', 'picked_up'), order('c', 'picked_up'), order('d', 'picked_up')];
  const assignments = [
    assignment('a', '2026-11-20T09:30:00.000Z'),
    assignment('b', null),
    assignment('c', '2026-11-20T08:00:00.000Z'),
    assignment('d', '2026-11-20T09:00:00.000Z'),
  ];
  const result = buildInProgressDeliveries(orders, assignments);
  assertEquals(result.map((r) => r.orderId), ['c', 'd', 'a', 'b']);
});

Deno.test('legacy status spellings are normalized and kept when not terminal', () => {
  const orders = [order('o1', 'pending'), order('o2', 'ready'), order('o3', 'confirmed')];
  const assignments = orders.map((o) => assignment(o.id, '2026-11-20T09:00:00.000Z'));
  const result = buildInProgressDeliveries(orders, assignments);
  assertEquals(result.map((r) => r.status), ['placed', 'ready_for_pickup', 'placed']);
});
