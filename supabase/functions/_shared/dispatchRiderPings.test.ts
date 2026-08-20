// Tests for Task 11 (D3): the rider-ping retention sweep that queue-drainer
// runs every minute.
//
// _shared/client.ts throws at module scope without SUPABASE_URL /
// SERVICE_ROLE_KEY set first, so the two env vars are set here before the
// module under test is imported dynamically - the same pattern
// dispatchSelection.test.ts uses. dispatchRiderPings.ts type-checks clean, so
// (like dispatchSelection.test.ts) this file runs in package.json's first,
// type-checked `deno test` invocation.
//
// The fake ebuy_delete_expired_dispatch_rider_pings rpc mirrors the
// migration's own predicate (recordedAt < now - retentionHours) against an
// in-memory row set, and every assertion below is against which ROWS remain
// afterward - never just "the rpc resolved" - so a call that forwarded the
// wrong retention window, or a handler that stopped calling the rpc at all,
// fails these tests exactly as loudly as one that deleted everything or
// nothing.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { DISPATCH_RIDER_PING_RETENTION_HOURS, sweepExpiredDispatchRiderPings } = await import(
  './dispatchRiderPings.ts'
);
const { serviceClient } = await import('./client.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

type PingRow = { id: string; recordedAt: string };

const HOUR_MS = 60 * 60 * 1000;

/**
 * Installs a fake ebuy_delete_expired_dispatch_rider_pings rpc over an
 * in-memory row set, deleting exactly the rows the real SQL predicate would:
 * `recordedAt < now - retentionHours`, bounded by the caller's limit.
 */
const installMocks = (rows: PingRow[]) => {
  const state = {
    rows: [...rows],
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string, params: Record<string, unknown>) => {
    if (fn !== 'ebuy_delete_expired_dispatch_rider_pings') {
      throw new Error(`dispatchRiderPings.test.ts: unexpected rpc "${fn}"`);
    }

    const retentionHours = (params.p_retention_hours as number) ?? 24;
    const limit = (params.p_limit as number) ?? 500;
    const cutoff = Date.now() - retentionHours * HOUR_MS;

    const due = state.rows.filter((row) => Date.parse(row.recordedAt) < cutoff).slice(0, limit);
    const dueIds = new Set(due.map((row) => row.id));
    state.rows = state.rows.filter((row) => !dueIds.has(row.id));

    return { data: due.length, error: null };
  };

  return state;
};

Deno.test('sweepExpiredDispatchRiderPings: deletes only rows older than the 24h cutoff, keeps newer rows', async () => {
  const now = Date.now();
  const rows: PingRow[] = [
    { id: 'old-1', recordedAt: new Date(now - 25 * HOUR_MS).toISOString() }, // older than cutoff - deleted
    { id: 'old-2', recordedAt: new Date(now - 48 * HOUR_MS).toISOString() }, // older than cutoff - deleted
    { id: 'new-1', recordedAt: new Date(now - 23 * HOUR_MS).toISOString() }, // inside retention - kept
    { id: 'new-2', recordedAt: new Date(now - 1 * HOUR_MS).toISOString() }, // fresh - kept
  ];
  const state = installMocks(rows);

  const result = await sweepExpiredDispatchRiderPings();

  expectEqual(result.deleted, 2, 'exactly the two rows older than the cutoff were reported deleted');
  expectEqual(state.rows.length, 2, 'exactly two rows remain in storage');
  expectEqual(
    state.rows.some((row) => row.id === 'old-1' || row.id === 'old-2'),
    false,
    'neither stale row survived the sweep'
  );
  expectEqual(
    state.rows.every((row) => row.id === 'new-1' || row.id === 'new-2'),
    true,
    'both rows inside the retention window are untouched'
  );
});

Deno.test('sweepExpiredDispatchRiderPings: a row exactly at the retention boundary is kept, not deleted', async () => {
  const now = Date.now();
  const rows: PingRow[] = [
    // Just inside the window (23h59m old) - must survive. The predicate is a
    // strict `<`, so anything not already past the full window stays.
    { id: 'boundary', recordedAt: new Date(now - (DISPATCH_RIDER_PING_RETENTION_HOURS * HOUR_MS - 60_000)).toISOString() },
  ];
  const state = installMocks(rows);

  const result = await sweepExpiredDispatchRiderPings();

  expectEqual(result.deleted, 0, 'nothing was deleted');
  expectEqual(state.rows.length, 1, 'the boundary row still exists');
});

Deno.test('sweepExpiredDispatchRiderPings: an empty table deletes nothing and does not throw', async () => {
  const state = installMocks([]);

  const result = await sweepExpiredDispatchRiderPings();

  expectEqual(result.deleted, 0, 'nothing to delete');
  expectEqual(state.rows.length, 0, 'still empty');
});

Deno.test('sweepExpiredDispatchRiderPings: a database error is swallowed and reported as zero deleted, not thrown', async () => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = async (fn: string) => {
    if (fn !== 'ebuy_delete_expired_dispatch_rider_pings') {
      throw new Error(`dispatchRiderPings.test.ts: unexpected rpc "${fn}"`);
    }
    return { data: null, error: { message: 'connection reset' } };
  };

  const result = await sweepExpiredDispatchRiderPings();

  expectEqual(result.deleted, 0, 'a sweep failure reports zero deleted rather than throwing - queue-drainer must not fail its whole drain over this');
});
