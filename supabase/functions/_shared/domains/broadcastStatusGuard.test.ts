// Tests that broadcastCancel and broadcastSchedule answer 412 with a readable
// message when the broadcast is no longer in a status they can act on.
//
// The broadcast runner moves rows on its own (scheduled -> sending -> sent),
// and the console's list can be minutes old, so a Cancel on a row that has
// already gone out is an ordinary race. Both writes used `.single()`, which on
// zero matched rows surfaced PostgREST's raw message as a 500.
//
// Calls the REAL handlers out of adminDomain.handlers, set up the same way as
// adminSetRestaurantPublished.test.ts (env first, then a dynamic import,
// because _shared/client.ts throws at module scope without them), and runs in
// package.json's --no-check deno invocation for the same reason.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { adminDomain } = await import('./admin.ts');
const { serviceClient } = await import('../client.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const cancel = adminDomain.handlers.broadcastCancel;
const schedule = adminDomain.handlers.broadcastSchedule;
if (typeof cancel !== 'function' || typeof schedule !== 'function') {
  throw new Error('broadcastCancel / broadcastSchedule are not registered on adminDomain.');
}

const ADMIN_CONTEXT = {
  email: 'admin@example.test',
  role: 'admin',
  token: 'fake-token',
  uid: 'admin-uid',
  userProfile: { uid: 'admin-uid', email: 'admin@example.test', role: 'admin', accountDisabled: false },
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

type BroadcastRow = { id: string; status: string; scheduledAt?: string | null };

/**
 * A one-row Broadcast table honouring the two shapes of conditional update
 * the handlers issue (`.eq('status', x)` and `.in('status', [...])`) plus the
 * plain read the refusal path makes.
 */
const installBroadcastTable = (row: BroadcastRow | null) => {
  const state = { row, updates: 0 };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table !== 'Broadcast') {
      throw new Error(`broadcastStatusGuard.test.ts: unexpected table "${table}"`);
    }

    return {
      select: (_columns: string) => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({ data: state.row && state.row.id === id ? { ...state.row } : null, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (_idColumn: string, id: string) => {
          const finish = (allowed: string[]) => ({
            select: (_columns: string) => ({
              maybeSingle: async () => {
                if (!state.row || state.row.id !== id || !allowed.includes(state.row.status)) {
                  return { data: null, error: null };
                }
                state.updates += 1;
                state.row = { ...state.row, ...(payload as Partial<BroadcastRow>) };
                return { data: { ...state.row }, error: null };
              },
            }),
          });
          return {
            eq: (_statusColumn: string, status: string) => finish([status]),
            in: (_statusColumn: string, statuses: string[]) => finish(statuses),
          };
        },
      }),
    };
  };

  return state;
};

const callExpectingFailure = async (run: () => Promise<Response>) => {
  try {
    await run();
  } catch (error) {
    return error as { status?: number; message?: string };
  }
  throw new Error('expected the handler to throw');
};

Deno.test('broadcastCancel: a broadcast the runner already sent answers 412 with its status', async () => {
  const state = installBroadcastTable({ id: 'b-1', status: 'sent' });

  const error = await callExpectingFailure(() =>
    cancel({ context: ADMIN_CONTEXT, data: { id: 'b-1' }, request: fakeRequest() })
  );

  expectEqual(error.status, 412, 'status');
  expectEqual(error.message?.includes('already sent'), true, `message names the status: ${error.message}`);
  expectEqual(state.updates, 0, 'no write happened');
  expectEqual(state.row?.status, 'sent', 'row untouched');
});

Deno.test('broadcastCancel: a broadcast that is sending answers 412, not 500', async () => {
  installBroadcastTable({ id: 'b-2', status: 'sending' });

  const error = await callExpectingFailure(() =>
    cancel({ context: ADMIN_CONTEXT, data: { id: 'b-2' }, request: fakeRequest() })
  );

  expectEqual(error.status, 412, 'status');
  expectEqual(error.message?.includes('already sending'), true, `message names the status: ${error.message}`);
});

Deno.test('broadcastCancel: an unknown broadcast answers 404', async () => {
  installBroadcastTable(null);

  const error = await callExpectingFailure(() =>
    cancel({ context: ADMIN_CONTEXT, data: { id: 'missing' }, request: fakeRequest() })
  );

  expectEqual(error.status, 404, 'status');
});

Deno.test('broadcastCancel: a scheduled broadcast is canceled', async () => {
  const state = installBroadcastTable({ id: 'b-3', status: 'scheduled' });

  const response = await cancel({ context: ADMIN_CONTEXT, data: { id: 'b-3' }, request: fakeRequest() });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.row?.status, 'canceled', 'row canceled');
});

Deno.test('broadcastSchedule: Send now on a broadcast already sent answers 412', async () => {
  const state = installBroadcastTable({ id: 'b-4', status: 'sent' });

  const error = await callExpectingFailure(() =>
    schedule({ context: ADMIN_CONTEXT, data: { id: 'b-4' }, request: fakeRequest() })
  );

  expectEqual(error.status, 412, 'status');
  expectEqual(error.message?.includes('already sent'), true, `message names the status: ${error.message}`);
  expectEqual(state.updates, 0, 'no write happened');
});

Deno.test('broadcastSchedule: a draft is scheduled', async () => {
  const state = installBroadcastTable({ id: 'b-5', status: 'draft' });

  const response = await schedule({ context: ADMIN_CONTEXT, data: { id: 'b-5' }, request: fakeRequest() });

  expectEqual(response.status, 200, 'status');
  expectEqual(state.row?.status, 'scheduled', 'row scheduled');
});
