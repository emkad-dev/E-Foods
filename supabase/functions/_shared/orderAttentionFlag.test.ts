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

// A PostgREST column, including a JSON path like 'timeline->>paymentReversedAt'
// (text, or null when absent).
const readColumn = (row: Row, column: string): unknown => {
  const [base, key] = column.split('->>');
  if (key === undefined) return row[base];
  const value = ((row[base] ?? {}) as Row)[key];
  return value === undefined || value === null ? null : String(value);
};

type InstallOptions = {
  /** Runs just before the follow-up clear is evaluated (a concurrent writer). */
  beforeClear?: (row: Row) => void;
  failClear?: boolean;
};

const install = (initial: Row, options: InstallOptions = {}) => {
  const row: Row = { ...initial };
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table !== 'CustomerOrder') throw new Error(`unexpected table ${table}`);
    return {
      update(payload: Row) {
        const preds: Array<(r: Row) => boolean> = [];
        // deno-lint-ignore no-explicit-any
        const builder: any = {
          eq: (c: string, v: unknown) => (preds.push((r) => readColumn(r, c) === v), builder),
          is: (c: string, v: unknown) => (preds.push((r) => (readColumn(r, c) ?? null) === v), builder),
          select: () => builder,
          then(resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) {
            const isClear = Object.keys(payload).length === 1 && payload.needsAttention === false;
            if (isClear && options.beforeClear) options.beforeClear(row);
            if (isClear && options.failClear) {
              return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
            }
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
  const fetches = { count: 0 };
  globalThis.fetch = (() => {
    fetches.count += 1;
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;
  return { row, fetches, restore: () => void (globalThis.fetch = originalFetch) };
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
    expectEqual(m.row.needsAttention, true, 'flag untouched by a refused CAS');
  } finally {
    m.restore();
  }
});

Deno.test('attention: a late-payment flag written between the status write and the clear survives', async () => {
  // The clear is a second statement. If another writer re-raises the flag in
  // between (and so bumps updatedAt), the clear must not hide that newer alert.
  const m = install(flagged({ status: 'cancelled', needsAttention: false }), {
    beforeClear: (row) => {
      row.needsAttention = true;
      row.updatedAt = '2099-01-01T00:00:00.000Z';
    },
  });
  try {
    // Seed: the status write below leaves needsAttention as the row has it.
    await updateOrderRecord('o1', { status: 'cancelled' });
    expectEqual(m.row.needsAttention, true, 'newer alert not cleared');
  } finally {
    m.restore();
  }
});

Deno.test('attention: the clear is guarded by the status it was written for', async () => {
  // Remove the .eq('status') guard in the clear and this fails: the order has
  // moved to another status by the time the clear runs.
  const m = install(flagged({ status: 'placed' }), {
    beforeClear: (row) => {
      row.status = 'preparing';
    },
  });
  try {
    await updateOrderRecord('o1', { status: 'accepted', updatedAt: 'stamp-1' });
    expectEqual(m.row.status, 'preparing', 'status moved on');
    expectEqual(m.row.needsAttention, true, 'clear skipped for a different status');
  } finally {
    m.restore();
  }
});

Deno.test('attention: a write that also raises needsAttention is never cleared', async () => {
  const m = install(flagged({ needsAttention: false }));
  try {
    await updateOrderRecord('o1', { status: 'cancelled', needsAttention: true });
    expectEqual(m.row.needsAttention, true, 'paid-rejection style write keeps its alert');
    expectEqual(statusWriteClearsAttention({ status: 'rejected', needsAttention: true }), false, 'predicate agrees');
  } finally {
    m.restore();
  }
});

Deno.test('attention: a failing clear neither throws nor skips the broadcast', async () => {
  const m = install(flagged({ status: 'on_the_way' }), { failClear: true });
  try {
    const applied = await updateOrderRecordIfStatus('o1', 'on_the_way', { status: 'delivered' });
    expectEqual(applied, true, 'action still reports success');
    expectEqual(m.row.status, 'delivered', 'status write stands');
    await updateOrderRecord('o1', { status: 'delivered' });
    if (m.fetches.count < 2) throw new Error('broadcast did not run after a failed clear (fetches=' + m.fetches.count + ')');
  } finally {
    m.restore();
  }
});

Deno.test('attention: a payment-reversal flag survives accept and terminal writes', async () => {
  // flagReversedPaidOrder raises needsAttention on a LIVE paid order Paystack
  // reversed. The kitchen accepting or completing it must not hide that.
  const reversed = { timeline: { paymentReversedAt: '2026-11-09T11:00:00.000Z' } };
  const accepted = install(flagged(reversed));
  try {
    await updateOrderRecordIfStatus('o1', 'placed', { status: 'accepted' });
    expectEqual(accepted.row.status, 'accepted', 'accept applied');
    expectEqual(accepted.row.needsAttention, true, 'reversal flag kept on accept');
  } finally {
    accepted.restore();
  }
  const delivered = install(flagged({ ...reversed, status: 'ready_for_pickup' }));
  try {
    await updateOrderRecord('o1', { status: 'delivered' });
    expectEqual(delivered.row.status, 'delivered', 'delivered applied');
    expectEqual(delivered.row.needsAttention, true, 'reversal flag kept on delivered');
  } finally {
    delivered.restore();
  }
});
