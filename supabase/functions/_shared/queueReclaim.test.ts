import { reclaimStaleQueueJobs, retryBackoffMs } from './queue.ts';

const assertEquals = (actual: unknown, expected: unknown, message = '') => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
};

type Row = { id: string; retry_count: number; status: string; updated_at: string; error?: string; available_at?: string };

// Minimal PostgREST-shaped fake: select(...).eq().lt().limit() reads, and
// update(patch).eq()...select() writes with the same eq filters as a CAS.
const fakeClient = (rows: Row[]) => {
  const from = (_table: string) => {
    let patch: Partial<Row> | null = null;
    const filters: Array<[keyof Row, unknown, 'eq' | 'lt']> = [];
    const matches = (row: Row) =>
      filters.every(([key, value, op]) => (op === 'eq' ? row[key] === value : String(row[key]) < String(value)));
    const builder: Record<string, unknown> = {
      eq: (key: keyof Row, value: unknown) => (filters.push([key, value, 'eq']), builder),
      limit: () => builder,
      lt: (key: keyof Row, value: unknown) => (filters.push([key, value, 'lt']), builder),
      select: () => builder,
      then: (resolve: (value: unknown) => void) => {
        const hit = rows.filter(matches);
        if (patch) {
          for (const row of hit) Object.assign(row, patch);
          resolve({ data: hit.map((row) => ({ id: row.id })), error: null });
        } else {
          resolve({ data: hit.map((row) => ({ ...row })), error: null });
        }
      },
      update: (next: Partial<Row>) => ((patch = next), builder),
    };
    return builder;
  };
  // deno-lint-ignore no-explicit-any
  return { from } as any;
};

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const STALE = '2026-10-21T11:50:00.000Z'; // 10 min old > 3 min visibility timeout
const FRESH = '2026-10-21T11:59:30.000Z';

Deno.test('a reclaimed stuck job counts as a retry and backs off', async () => {
  const rows: Row[] = [{ id: 'j1', retry_count: 0, status: 'processing', updated_at: STALE }];
  const result = await reclaimStaleQueueJobs(fakeClient(rows), 'notifications', { maxRetries: 3 }, NOW);
  assertEquals(result, { deadLettered: 0, reclaimed: 1 });
  assertEquals(rows[0].status, 'pending');
  assertEquals(rows[0].retry_count, 1);
  assertEquals(rows[0].available_at, new Date(NOW + retryBackoffMs(1)).toISOString());
});

Deno.test('a job that keeps timing out the worker is dead-lettered past maxRetries', async () => {
  const rows: Row[] = [{ id: 'j2', retry_count: 3, status: 'processing', updated_at: STALE }];
  const dead: unknown[] = [];
  const result = await reclaimStaleQueueJobs(
    fakeClient(rows),
    'notifications',
    { maxRetries: 3, onDeadLetter: (job) => void dead.push(job) },
    NOW
  );
  assertEquals(result, { deadLettered: 1, reclaimed: 0 });
  assertEquals(rows[0].status, 'failed');
  assertEquals(dead, [{ id: 'j2', queue: 'notifications', retryCount: 4 }]);
});

Deno.test('jobs still inside the visibility timeout are left alone', async () => {
  const rows: Row[] = [{ id: 'j3', retry_count: 0, status: 'processing', updated_at: FRESH }];
  const result = await reclaimStaleQueueJobs(fakeClient(rows), 'notifications', {}, NOW);
  assertEquals(result, { deadLettered: 0, reclaimed: 0 });
  assertEquals(rows[0].status, 'processing');
});
