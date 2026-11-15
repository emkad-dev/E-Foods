// Tests for adminResolveOperationalAlert and for what happens to a resolved
// alert when the same condition is raised again.
//
// Alerts had no resolution, so October's alerts were still listed weeks after
// the problems were fixed. Resolving hides an alert from the default list; a
// writer that raises the same dedupeKey again must bring it back as a fresh,
// open alert rather than update a row the console no longer shows.
//
// Calls the REAL handler out of adminDomain.handlers and the REAL
// recordOperationalAlert / loadOperationalAlerts against one in-memory
// OperationalAlert table. Set up like adminSetRestaurantPublished.test.ts (env
// first, then dynamic imports, because _shared/client.ts throws at module scope
// without them) and run in package.json's --no-check deno invocation.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { adminDomain } = await import('./admin.ts');
const { serviceClient } = await import('../client.ts');
const { loadOperationalAlerts, recordOperationalAlert } = await import('../operationalAlerts.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const handler = adminDomain.handlers.adminResolveOperationalAlert;
if (typeof handler !== 'function') {
  throw new Error('adminDomain.handlers.adminResolveOperationalAlert is not registered.');
}

const ADMIN_CONTEXT = {
  email: 'admin@example.test',
  role: 'admin',
  token: 'fake-token',
  uid: 'admin-uid',
  userProfile: { uid: 'admin-uid', email: 'admin@example.test', role: 'admin', accountDisabled: false },
};

const fakeRequest = () => new Request('https://example.test/rpc', { method: 'POST' });

type Row = Record<string, unknown> & { id: string; dedupeKey: string };

/**
 * A small OperationalAlert table: the conditional update the resolve path
 * issues, the read-back, the upsert-on-dedupeKey every writer uses (which only
 * overwrites the columns it is given, as PostgREST does), and the filtered
 * list read.
 */
const installTable = (initial: Row[]) => {
  const state = { rows: initial.map((row) => ({ ...row })), audits: [] as Array<Record<string, unknown>>, nextId: 100 };

  const filtered = (filters: Array<(row: Row) => boolean>) => state.rows.filter((row) => filters.every((f) => f(row)));

  // deno-lint-ignore no-explicit-any
  const selectBuilder = (filters: Array<(row: Row) => boolean>): any => ({
    eq: (column: string, value: unknown) => selectBuilder([...filters, (row) => row[column] === value]),
    is: (column: string, value: unknown) => selectBuilder([...filters, (row) => (row[column] ?? null) === value]),
    maybeSingle: async () => {
      const rows = filtered(filters);
      return { data: rows[0] ? { ...rows[0] } : null, error: null };
    },
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: filtered(filters).map((row) => ({ ...row })), error: null }),
  });

  // deno-lint-ignore no-explicit-any
  const updateBuilder = (payload: Record<string, unknown>, filters: Array<(row: Row) => boolean>): any => ({
    eq: (column: string, value: unknown) => updateBuilder(payload, [...filters, (row) => row[column] === value]),
    is: (column: string, value: unknown) =>
      updateBuilder(payload, [...filters, (row) => (row[column] ?? null) === value]),
    select: (_columns: string) => ({
      maybeSingle: async () => {
        const rows = filtered(filters);
        if (rows.length === 0) {
          return { data: null, error: null };
        }
        Object.assign(rows[0], payload);
        return { data: { ...rows[0] }, error: null };
      },
    }),
  });

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table === 'AdminAuditLog') {
      return {
        insert: async (payload: Record<string, unknown>) => {
          state.audits.push(payload);
          return { error: null };
        },
      };
    }
    if (table !== 'OperationalAlert') {
      throw new Error(`adminResolveOperationalAlert.test.ts: unexpected table "${table}"`);
    }
    return {
      select: (_columns: string) => selectBuilder([]),
      update: (payload: Record<string, unknown>) => updateBuilder(payload, []),
      upsert: async (payload: Record<string, unknown>, options?: { onConflict?: string }) => {
        expectEqual(options?.onConflict, 'dedupeKey', 'writers upsert on dedupeKey');
        const existing = state.rows.find((row) => row.dedupeKey === payload.dedupeKey);
        if (existing) {
          Object.assign(existing, payload);
        } else {
          state.rows.push({ ...(payload as Row), id: `alert-${state.nextId++}` });
        }
        return { error: null };
      },
    };
  };

  return state;
};

const OPEN_ALERT: Row = {
  id: 'alert-1',
  dedupeKey: 'ops:dispatch_pool_empty:order-1',
  alertType: 'dispatch_pool_empty',
  severity: 'medium',
  subjectType: 'order',
  subjectId: 'order-1',
  title: 'Dispatch pool empty',
  details: 'No available dispatch rider could be found for order order-1.',
  metadata: {},
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  resolvedAt: null,
  resolvedBy: null,
};

Deno.test('adminResolveOperationalAlert: a non-admin caller is refused with 403 before any write', async () => {
  const state = installTable([OPEN_ALERT]);
  let thrown: { status?: number } | null = null;
  try {
    await handler({ context: { ...ADMIN_CONTEXT, role: 'support' }, data: { alertId: 'alert-1' }, request: fakeRequest() });
  } catch (error) {
    thrown = error as { status?: number };
  }
  expectEqual(thrown?.status, 403, 'status');
  expectEqual(state.rows[0].resolvedAt, null, 'still open');
  expectEqual(state.audits.length, 0, 'no audit row');
});

Deno.test('adminResolveOperationalAlert: resolves an open alert, records who, and audits it', async () => {
  const state = installTable([OPEN_ALERT]);

  const response = await handler({ context: ADMIN_CONTEXT, data: { alertId: 'alert-1' }, request: fakeRequest() });
  const body = await response.json();

  expectEqual(response.status, 200, 'status');
  expectEqual(body.data.alreadyResolved, false, 'alreadyResolved');
  expectEqual(typeof state.rows[0].resolvedAt, 'string', 'resolvedAt stamped');
  expectEqual(state.rows[0].resolvedBy, 'admin-uid', 'resolvedBy');
  expectEqual(state.rows[0].updatedAt, OPEN_ALERT.updatedAt, 'updatedAt untouched');
  expectEqual(state.audits.length, 1, 'one audit row');
  expectEqual(state.audits[0].action, 'operational_alert_resolved', 'audit action');
  expectEqual(state.audits[0].targetId, 'alert-1', 'audit target');
});

Deno.test('adminResolveOperationalAlert: resolving twice keeps the first resolver and does not audit again', async () => {
  const state = installTable([
    { ...OPEN_ALERT, resolvedAt: '2026-11-01T09:00:00.000Z', resolvedBy: 'first-admin' },
  ]);

  const response = await handler({ context: ADMIN_CONTEXT, data: { alertId: 'alert-1' }, request: fakeRequest() });
  const body = await response.json();

  expectEqual(response.status, 200, 'status');
  expectEqual(body.data.alreadyResolved, true, 'alreadyResolved');
  expectEqual(state.rows[0].resolvedBy, 'first-admin', 'first resolver kept');
  expectEqual(state.audits.length, 0, 'no second audit row');
});

Deno.test('adminResolveOperationalAlert: an unknown alert answers 404, a missing id 400', async () => {
  installTable([OPEN_ALERT]);
  for (const [alertId, status] of [['nope', 404], ['', 400]] as const) {
    let thrown: { status?: number } | null = null;
    try {
      await handler({ context: ADMIN_CONTEXT, data: { alertId }, request: fakeRequest() });
    } catch (error) {
      thrown = error as { status?: number };
    }
    expectEqual(thrown?.status, status, `status for "${alertId}"`);
  }
});

Deno.test('a resolved alert leaves the default list, and raising the same dedupeKey again re-opens it fresh', async () => {
  const state = installTable([OPEN_ALERT]);

  await handler({ context: ADMIN_CONTEXT, data: { alertId: 'alert-1' }, request: fakeRequest() });

  expectEqual((await loadOperationalAlerts({})).length, 0, 'resolved alert hidden by default');
  expectEqual((await loadOperationalAlerts({ includeResolved: true })).length, 1, 'shown when asked for');

  // The same condition comes back, through the ordinary writer.
  await recordOperationalAlert({
    alertType: 'dispatch_pool_empty',
    dedupeKey: OPEN_ALERT.dedupeKey,
    details: 'No available dispatch rider could be found for order order-1.',
    severity: 'medium',
    subjectId: 'order-1',
    subjectType: 'order',
    title: 'Dispatch pool empty',
  });

  expectEqual(state.rows.length, 1, 'no second row for the same dedupeKey');
  expectEqual(state.rows[0].resolvedAt, null, 'resolvedAt cleared');
  expectEqual(state.rows[0].resolvedBy, null, 'resolvedBy cleared');
  expectEqual(
    Date.parse(String(state.rows[0].createdAt)) > Date.parse(OPEN_ALERT.createdAt),
    true,
    'createdAt moved, so it reads as a fresh alert'
  );

  const open = await loadOperationalAlerts({});
  expectEqual(open.length, 1, 're-raised alert is back in the default list');
  expectEqual(open[0].resolvedAt, null, 'listed as open');
});
