// Tests for the `dispatchSetAvailability` handler (SP-3 Task 1): a rider flips
// themselves Available/Offline. A dispatch caller can only ever touch their
// OWN DispatchRiderRecord row; an admin may target another rider.
//
// Calls the REAL handler out of dispatchDomain.handlers with a fake
// serviceClient, the same pattern as domains/adminSetRestaurantPublished.test.ts
// (env stubs first, then a dynamic import, because _shared/client.ts throws at
// module scope without them). Needs the --no-check test:deno invocation.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./domains/dispatch.ts');
const { serviceClient } = await import('./client.ts');

const handler = dispatchDomain.handlers.dispatchSetAvailability;
if (typeof handler !== 'function') {
  throw new Error('dispatchDomain.handlers.dispatchSetAvailability is not registered.');
}

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const contextFor = (role: string, uid: string) => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

type UpdateCall = { table: string; payload: Record<string, unknown>; column: string; value: unknown };

const installMock = (): UpdateCall[] => {
  const calls: UpdateCall[] = [];
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => ({
    update: (payload: Record<string, unknown>) => ({
      eq: async (column: string, value: unknown) => {
        calls.push({ table, payload, column, value });
        return { error: null };
      },
    }),
  });
  return calls;
};

const call = async (role: string, uid: string, data: Record<string, unknown>) => {
  const response = await handler({
    context: contextFor(role, uid),
    data,
    request: new Request('https://example.test/rpc', { method: 'POST' }),
  });
  return { status: response.status, body: await response.json() };
};

Deno.test('dispatchSetAvailability: available=false sets the caller\'s own row Offline', async () => {
  const calls = installMock();
  const { status, body } = await call('dispatch', 'rider-1', { available: false });

  expectEqual(status, 200, 'status');
  expectEqual(calls.length, 1, 'update count');
  expectEqual(calls[0].table, 'DispatchRiderRecord', 'table');
  expectEqual(calls[0].payload.status, 'Offline', 'update status');
  expectEqual(typeof calls[0].payload.updatedAt, 'string', 'updatedAt set');
  expectEqual([calls[0].column, calls[0].value], ['id', 'rider-1'], 'eq target');
  expectEqual(body.data, { courierId: 'rider-1', status: 'Offline' }, 'response data');
});

Deno.test('dispatchSetAvailability: available=true sets the caller\'s own row Available', async () => {
  const calls = installMock();
  const { body } = await call('dispatch', 'rider-1', { available: true });

  expectEqual(calls.length, 1, 'update count');
  expectEqual(calls[0].payload.status, 'Available', 'update status');
  expectEqual([calls[0].column, calls[0].value], ['id', 'rider-1'], 'eq target');
  expectEqual(body.data, { courierId: 'rider-1', status: 'Available' }, 'response data');
});

Deno.test('dispatchSetAvailability: a dispatch caller cannot target another rider via courierId', async () => {
  const calls = installMock();
  const { body } = await call('dispatch', 'rider-1', { available: false, courierId: 'other-rider' });

  expectEqual(calls.length, 1, 'update count');
  expectEqual([calls[0].column, calls[0].value], ['id', 'rider-1'], 'eq target is the caller, not other-rider');
  expectEqual(body.data, { courierId: 'rider-1', status: 'Offline' }, 'response data');
});

Deno.test('dispatchSetAvailability: an admin caller can target another rider via courierId', async () => {
  const calls = installMock();
  const { body } = await call('admin', 'admin-uid', { available: true, courierId: 'other-rider' });

  expectEqual(calls.length, 1, 'update count');
  expectEqual(calls[0].payload.status, 'Available', 'update status');
  expectEqual([calls[0].column, calls[0].value], ['id', 'other-rider'], 'eq target');
  expectEqual(body.data, { courierId: 'other-rider', status: 'Available' }, 'response data');
});
