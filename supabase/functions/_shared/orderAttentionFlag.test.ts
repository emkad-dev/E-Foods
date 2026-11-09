// needsAttention is raised by the acceptance escalation (or a late payment) and
// must stop asking for a human once the restaurant accepts or the order reaches
// a terminal status - unless the customer reported a problem
// (customerIssueReportedAt), which must stay flagged. These drive the REAL
// updateOrderRecord / updateOrderRecordIfStatus (the single funnel every
// partner, dispatch, customer-cancel and sweep status write goes through)
// against an in-memory CustomerOrder table, and assert the STORED flag.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { updateOrderRecord, updateOrderRecordIfStatus, statusWriteClearsAttention } = await import('./orders.ts');
const { serviceClient } = await import('./client.ts');

type Row = Record<string, unknown>;

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const install = (initial: Row) => {
  const row: Row = { ...initial };
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table !== 'CustomerOrder') throw new Error(`unexpected table ${table}`);
    return {
      update(payload: Row) {
        const preds: Array<(r: Row) => boolean> = [];
        // deno-lint-ignore no-explicit-any
        const builder: any = {
          eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), builder),
          is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), builder),
          select: () => builder,
          then(resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) {
            const matched = preds.every((p) => p(row));
            if (matched) Object.assign(row, payload);
            return Promise.resolve({ data: matched ? [{ id: row.id }] : [], error: null }).then(resolve, reject);
          },
        };
        return builder;
      },
    };
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{}', { status: 200 }))) as typeof fetch;
  return { row, restore: () => void (globalThis.fetch = originalFetch) };
};

const flagged = (overrides: Row = {}): Row => ({
  id: 'o1',
  status: 'placed',
  needsAttention: true,
  customerIssueReportedAt: null,
  ...overrides,
});

Deno.test('attention: the restaurant accepting clears the flag', async () => {
  const m = install(flagged());
  try {
    const applied = await updateOrderRecordIfStatus('o1', 'placed', { status: 'accepted' });
    expectEqual(applied, true, 'accept applied');
    expectEqual(m.row.status, 'accepted', 'status');
    expectEqual(m.row.needsAttention, false, 'flag cleared on accept');
  } finally {
    m.restore();
  }
});

Deno.test('attention: reaching delivered clears the flag', async () => {
  const m = install(flagged({ status: 'on_the_way' }));
  try {
    await updateOrderRecordIfStatus('o1', 'on_the_way', { status: 'delivered' });
    expectEqual(m.row.needsAttention, false, 'flag cleared on delivered');
  } finally {
    m.restore();
  }
});

Deno.test('attention: every terminal status clears the flag via updateOrderRecord (customer cancel, timeout)', async () => {
  for (const status of ['cancelled', 'rejected', 'failed_delivery', 'delivered']) {
    const m = install(flagged());
    try {
      await updateOrderRecord('o1', { status });
      expectEqual(m.row.needsAttention, false, `flag cleared on ${status}`);
    } finally {
      m.restore();
    }
  }
});

Deno.test('attention: a customer-reported order keeps the flag through delivered', async () => {
  const m = install(flagged({ status: 'on_the_way', customerIssueReportedAt: '2026-11-09T11:00:00.000Z' }));
  try {
    await updateOrderRecordIfStatus('o1', 'on_the_way', { status: 'delivered' });
    expectEqual(m.row.status, 'delivered', 'status moved');
    expectEqual(m.row.needsAttention, true, 'reported order stays flagged');
  } finally {
    m.restore();
  }
});

Deno.test('attention: non-clearing writes leave the flag alone', async () => {
  const m = install(flagged());
  try {
    await updateOrderRecord('o1', { updatedAt: 'x' });
    await updateOrderRecord('o1', { status: 'preparing' });
    expectEqual(m.row.needsAttention, true, 'preparing/updatedAt do not clear');
    expectEqual(statusWriteClearsAttention({ status: 'ready' }), false, 'ready_for_pickup is not terminal');
  } finally {
    m.restore();
  }
});

Deno.test('attention: a stale CAS (status moved on) neither writes nor clears', async () => {
  const m = install(flagged({ status: 'cancelled' }));
  try {
    const applied = await updateOrderRecordIfStatus('o1', 'placed', { status: 'accepted' });
    expectEqual(applied, false, 'CAS refused');
    expectEqual(m.row.status, 'cancelled', 'status unchanged');
  } finally {
    m.restore();
  }
});
