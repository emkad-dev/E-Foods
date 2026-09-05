Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

import { assertEquals, assertStrictEquals } from 'jsr:@std/assert';

const [{ recordRiskEvent, loadRiskEvents, loadRiskEventDetail }, { serviceClient }] = await Promise.all([
  import('./riskEvents.ts'),
  import('./client.ts'),
]);

Deno.test('recordRiskEvent upserts a stable dedupe key and keeps the latest payload', async () => {
  const writes: Array<Record<string, unknown>> = [];

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table !== 'RiskEvent') {
      throw new Error(`unexpected table ${table}`);
    }

    return {
      upsert: async (payload: Record<string, unknown>, opts?: { onConflict?: string }) => {
        writes.push({ ...payload, __onConflict: opts?.onConflict });
        return { error: null };
      },
    };
  };

  const row = await recordRiskEvent({
    dedupeKey: 'velocity:account:customer-1:2026-08-27T09:00:00.000Z',
    eventType: 'account_velocity',
    severity: 'medium',
    subjectType: 'account',
    subjectId: 'customer-1',
    score: 5,
    reason: 'Placed 5 orders in the last hour',
    metadata: { count: 5 },
    actorUid: 'customer-1',
    orderId: 'order-1',
  });

  assertEquals(writes.length, 1);
  assertEquals(writes[0].dedupeKey, 'velocity:account:customer-1:2026-08-27T09:00:00.000Z');
  assertEquals(writes[0].__onConflict, 'dedupeKey');
  assertEquals(row?.eventType, 'account_velocity');
  assertEquals(row?.subjectId, 'customer-1');
  assertEquals(row?.score, 5);
});

Deno.test('recordRiskEvent returns null when persistence fails', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((value) => String(value)).join(' '));
  };

  try {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = (table: string) => {
      if (table !== 'RiskEvent') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        upsert: async () => ({
          error: { message: 'write failed' },
        }),
      };
    };

    const row = await recordRiskEvent({
      dedupeKey: 'velocity:account:customer-2:2026-08-27T10:00:00.000Z',
      eventType: 'account_velocity',
      severity: 'high',
      subjectType: 'account',
      subjectId: 'customer-2',
      score: 8,
      reason: 'Placed 8 orders in the last hour',
      metadata: { count: 8 },
    });

    assertStrictEquals(row, null);
    assertEquals(errors.length, 1);
  } finally {
    console.error = originalError;
  }
});

Deno.test('loadRiskEvents filters and sorts by severity then recency', async () => {
  const filters: Array<[string, unknown]> = [];
  const rows = [
    {
      id: 'risk-1',
      dedupeKey: 'risk-1',
      eventType: 'account_velocity',
      severity: 'medium',
      subjectType: 'account',
      subjectId: 'customer-1',
      actorUid: 'customer-1',
      orderId: null,
      score: 5,
      reason: 'medium row',
      metadata: { count: 5 },
      createdAt: '2026-08-27T09:00:00.000Z',
      updatedAt: '2026-08-27T09:00:00.000Z',
    },
    {
      id: 'risk-2',
      dedupeKey: 'risk-2',
      eventType: 'account_velocity',
      severity: 'high',
      subjectType: 'account',
      subjectId: 'customer-1',
      actorUid: 'customer-1',
      orderId: null,
      score: 8,
      reason: 'high row',
      metadata: { count: 8 },
      createdAt: '2026-08-27T09:10:00.000Z',
      updatedAt: '2026-08-27T09:10:00.000Z',
    },
    {
      id: 'risk-3',
      dedupeKey: 'risk-3',
      eventType: 'account_velocity',
      severity: 'high',
      subjectType: 'account',
      subjectId: 'customer-1',
      actorUid: 'customer-1',
      orderId: null,
      score: 9,
      reason: 'newer high row',
      metadata: { count: 9 },
      createdAt: '2026-08-27T10:10:00.000Z',
      updatedAt: '2026-08-27T10:10:00.000Z',
    },
  ];

  const query = {
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return query;
    },
    then(resolve: (value: { data: typeof rows; error: null }) => unknown, reject?: (reason?: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table !== 'RiskEvent') {
      throw new Error(`unexpected table ${table}`);
    }

    return {
      select: () => query,
    };
  };

  const events = await loadRiskEvents({
    eventType: 'account_velocity',
    severity: 'high',
    subjectType: 'account',
    subjectId: 'customer-1',
    limit: 2,
  });

  assertEquals(filters, [
    ['eventType', 'account_velocity'],
    ['severity', 'high'],
    ['subjectType', 'account'],
    ['subjectId', 'customer-1'],
  ]);
  assertEquals(events.length, 2);
  assertEquals(events[0].id, 'risk-3');
  assertEquals(events[1].id, 'risk-2');
});

Deno.test('loadRiskEventDetail returns the matching row', async () => {
  const row = {
    id: 'risk-detail-1',
    dedupeKey: 'risk-detail-1',
    eventType: 'refund_abuse',
    severity: 'medium',
    subjectType: 'account',
    subjectId: 'customer-9',
    actorUid: null,
    orderId: null,
    score: 3,
    reason: 'detail row',
    metadata: { refunds: 3 },
    createdAt: '2026-08-27T10:20:00.000Z',
    updatedAt: '2026-08-27T10:20:00.000Z',
  };

  let requestedId = '';
  const query = {
    eq(column: string, value: unknown) {
      if (column === 'id') {
        requestedId = String(value);
      }
      return query;
    },
    maybeSingle: async () => ({ data: row, error: null }),
  };

  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => {
    if (table !== 'RiskEvent') {
      throw new Error(`unexpected table ${table}`);
    }

    return {
      select: () => query,
    };
  };

  const detail = await loadRiskEventDetail('risk-detail-1');

  assertEquals(requestedId, 'risk-detail-1');
  assertEquals(detail?.id, 'risk-detail-1');
  assertEquals(detail?.severity, 'medium');
});
