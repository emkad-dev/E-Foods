// Paystack refund execution (_shared/paystackRefund.ts) against an in-memory
// fake of the tables it touches. The money-safety rules come first: one
// execution per order under concurrent calls, the amount cap, and refusing a
// payment that was not captured or whose refund was not recorded. Then the
// refund webhook: idempotent, redelivery-safe, notifying once.
//
// The fake applies every filter of an UPDATE together, the way Postgres
// re-evaluates the WHERE under the row lock, and understands the JSON paths the
// module filters on ('payment->refundExecution->>status'). Paystack is never
// called: the transport is injected, or fetch is stubbed.
//
// Runs in package.json's --no-check `deno test` group: the module imports
// _shared/client.ts, which throws at module scope without these env vars.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');
Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_not_real');

import { assertEquals } from 'jsr:@std/assert';

const { serviceClient } = await import('./client.ts');
const { applyRefundWebhook, isAutoRefundEnabled, sendOrderRefund, startAutomaticRefund } = await import(
  './paystackRefund.ts'
);
const { initiatePaystackRefund } = await import('./paystack.ts');

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type PaystackOutcome = Awaited<ReturnType<typeof initiatePaystackRefund>>;
type InitiateInput = Parameters<typeof initiatePaystackRefund>[0];

const ORDER_ID = '0b7f2a52-1111-4c3e-9d1a-8f6e2a1b3c4d';
const OTHER_ORDER_ID = '0b7f2a52-2222-4c3e-9d1a-8f6e2a1b3c4d';
const CUSTOMER_UID = 'cust-refund-1';
const ADMIN_UID = 'admin-refund-1';
const TX_REFERENCE = 'FEASTY-CRD-1B3C4D-1700000000000';
const CAPTURED = 4300;
const REF_1 = 'feasty_rf_0b7f2a5211114c3e9d1a8f6e2a1b3c4d_1';
const REF_2 = 'feasty_rf_0b7f2a5211114c3e9d1a8f6e2a1b3c4d_2';

let db: Record<string, Row[]> = {};
let rpcCalls: Array<{ fn: string; params: Row }> = [];
let fetchBodies: Array<{ body: string; url: string }> = [];
let updateHook: { when: (table: string, payload: Row) => boolean; run: () => void } | null = null;
let failAllReads = false;

// A PostgREST column with JSON paths: '->' keeps JSON, a final '->>' gives text.
const readColumn = (row: Row, column: string): unknown => {
  const textMode = column.includes('->>');
  const [base, ...path] = column.split(/->>|->/);
  let value: unknown = row[base];
  for (const key of path) {
    value = value && typeof value === 'object' ? (value as Row)[key] : undefined;
  }
  if (value === undefined || value === null) return null;
  return textMode ? (typeof value === 'object' ? JSON.stringify(value) : String(value)) : value;
};

const makeBuilder = (table: string) => {
  const filters: Array<(row: Row) => boolean> = [];
  let op: 'select' | 'update' | 'upsert' | 'insert' | 'delete' = 'select';
  let payload: Row | Row[] | null = null;
  let upsertConflict: string | null = null;

  const execute = (mode: 'single' | 'maybeSingle' | 'many') => {
    if (failAllReads && op === 'select') {
      return Promise.resolve({ data: null, error: { message: 'database unavailable' } });
    }
    if (op === 'update' && updateHook && updateHook.when(table, payload as Row)) {
      const hook = updateHook;
      updateHook = null;
      hook.run();
    }
    const rows = (db[table] ??= []);
    const matches = rows.filter((row) => filters.every((filter) => filter(row)));
    if (op === 'select') {
      const data = matches.map((row) => structuredClone(row));
      return Promise.resolve({ data: mode === 'many' ? data : (data[0] ?? null), error: null });
    }
    if (op === 'update') {
      for (const row of matches) Object.assign(row, structuredClone(payload));
      const data = matches.map((row) => structuredClone(row));
      return Promise.resolve({ data: mode === 'many' ? data : (data[0] ?? null), error: null });
    }
    if (op === 'insert') {
      for (const item of Array.isArray(payload) ? payload : [payload]) rows.push(structuredClone(item as Row));
      return Promise.resolve({ data: null, error: null });
    }
    if (op === 'upsert') {
      const key = upsertConflict ?? 'id';
      const item = payload as Row;
      const existing = rows.find((row) => row[key] === item[key]);
      if (existing) Object.assign(existing, structuredClone(item));
      else rows.push(structuredClone(item));
      return Promise.resolve({ data: null, error: null });
    }
    db[table] = rows.filter((row) => !matches.includes(row));
    return Promise.resolve({ data: null, error: null });
  };

  const addFilter = (filter: (row: Row) => boolean) => {
    filters.push(filter);
    return builder;
  };

  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => addFilter((row) => readColumn(row, column) === value),
    neq: (column: string, value: unknown) => addFilter((row) => readColumn(row, column) !== value),
    in: (column: string, values: unknown[]) => addFilter((row) => values.includes(readColumn(row, column))),
    is: (column: string, value: unknown) => addFilter((row) => (readColumn(row, column) ?? null) === value),
    gte: () => builder,
    lte: () => builder,
    lt: () => builder,
    gt: () => builder,
    order: () => builder,
    limit: () => builder,
    returns: () => builder,
    update: (value: Row) => {
      op = 'update';
      payload = value;
      return builder;
    },
    insert: (value: Row | Row[]) => {
      op = 'insert';
      payload = value;
      return builder;
    },
    upsert: (value: Row, options?: { onConflict?: string }) => {
      op = 'upsert';
      payload = value;
      upsertConflict = options?.onConflict ?? null;
      return builder;
    },
    delete: () => {
      op = 'delete';
      return builder;
    },
    single: () => execute('single'),
    maybeSingle: () => execute('maybeSingle'),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      execute('many').then(resolve, reject),
  };
  return builder;
};

const originalFrom = serviceClient.from.bind(serviceClient);
const originalRpc = serviceClient.rpc.bind(serviceClient);
const originalFetch = globalThis.fetch;
const originalConsole = { error: console.error, warn: console.warn, log: console.log, info: console.info };

const refundedPayment = (overrides: Row = {}): Row => ({
  method: 'card',
  provider: 'paystack',
  reference: TX_REFERENCE,
  status: 'refunded',
  capturedAmount: CAPTURED,
  paidAt: '2026-11-17T09:00:00.000Z',
  refundAmount: CAPTURED,
  refundedAt: '2026-11-17T09:30:00.000Z',
  paystackResponse: { amount: CAPTURED * 100, reference: TX_REFERENCE },
  ...overrides,
});

const makeOrder = (overrides: Row = {}): Row => ({
  id: ORDER_ID,
  customerId: CUSTOMER_UID,
  restaurantId: 'rest-1',
  restaurantName: 'Test Kitchen',
  orderGroupId: null,
  status: 'rejected',
  needsAttention: true,
  customerIssueReportedAt: null,
  payment: refundedPayment(),
  pricing: { total: CAPTURED },
  timeline: {},
  createdAt: '2026-11-17T08:59:00.000Z',
  updatedAt: '2026-11-17T09:30:00.000Z',
  ...overrides,
});

const setup = (...orders: Row[]) => {
  db = {
    CustomerOrder: orders.map((row) => structuredClone(row)),
    DeliveryEvent: [],
    FeatureFlag: [],
    OperationalAlert: [],
    PushDevice: [],
    UserAccount: [{ uid: CUSTOMER_UID, expoPushToken: 'ExponentPushToken[customer-refund]' }],
    UserRole: [{ userId: ADMIN_UID, role: 'admin', restaurantId: null }],
  };
  rpcCalls = [];
  fetchBodies = [];
  updateHook = null;
  failAllReads = false;
};

const withHarness = async (work: () => Promise<void>) => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => makeBuilder(table);
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = (fn: string, params: Row) => {
    rpcCalls.push({ fn, params });
    return Promise.resolve({ data: fn === 'auth_rl_hit' ? [{ allowed: true }] : [], error: null });
  };
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    fetchBodies.push({ body: String(init?.body ?? ''), url: String(input) });
    return Promise.resolve(new Response('{"data":[]}', { status: 200 }));
  }) as typeof fetch;
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  console.info = () => {};
  try {
    await work();
  } finally {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = originalFrom;
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).rpc = originalRpc;
    globalThis.fetch = originalFetch;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    updateHook = null;
  }
};

/** An injected Paystack transport that records every request. */
const fakePaystack = (outcome: PaystackOutcome | (() => PaystackOutcome | Promise<PaystackOutcome>)) => {
  const calls: InitiateInput[] = [];
  return {
    calls,
    deps: {
      initiate: async (input: InitiateInput) => {
        calls.push(input);
        return typeof outcome === 'function' ? await outcome() : outcome;
      },
    },
  };
};

const accepted = (status = 'pending', id = 3018284): PaystackOutcome => ({
  data: { id, reference: REF_1, status },
  kind: 'ok',
});

const order = (id = ORDER_ID) => db.CustomerOrder.find((row) => row.id === id) as Row;
const execution = (id = ORDER_ID) => order(id).payment.refundExecution as Row | undefined;
const alerts = (type: string) => db.OperationalAlert.filter((alert) => alert.alertType === type);
const events = (type: string) => db.DeliveryEvent.filter((event) => event.eventType === type);
const customerPushes = () => fetchBodies.filter((call) => call.body.includes('Refund on its way'));
const adminEmails = (type: string) =>
  rpcCalls.filter((call) => call.fn === 'auth_rl_hit' && call.params.p_key === `admin-alert-email:${type}:${ORDER_ID}`);

// ───────────────────── one refund per order (compare-and-set) ─────────────────────

Deno.test('two concurrent admin clicks send exactly one Paystack refund', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const paystack = fakePaystack(accepted());
    const results = await Promise.all([
      sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps),
      sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'admin:admin-2' }, paystack.deps),
    ]);
    assertEquals(paystack.calls.length, 1, 'one request reached Paystack');
    assertEquals(results.map((result) => result.kind).sort(), ['changed', 'sent']);
    assertEquals(execution()?.status, 'pending');
    assertEquals(execution()?.attempt, 1);

    // And a third click afterwards is refused outright.
    const third = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps);
    assertEquals(third, { kind: 'refused', reason: 'already_started' });
    assertEquals(paystack.calls.length, 1);
  });
});

Deno.test('an automatic refund racing an admin click: the claim committed first wins, the other sends nothing', async () => {
  // Second case: the competing write did not move updatedAt, so only the
  // execution guard itself can stop the second claim.
  for (const bumpsUpdatedAt of [true, false]) {
    await withHarness(async () => {
      setup(makeOrder());
      const paystack = fakePaystack(accepted());
      // The admin's claim commits between the auto refund's read and its claim.
      updateHook = {
        when: (table, payload) => table === 'CustomerOrder' && payload.payment?.refundExecution?.requestedBy === 'auto',
        run: () => {
          order().payment.refundExecution = {
            amount: CAPTURED,
            attempt: 1,
            reference: REF_1,
            requestedAt: '2026-11-17T10:00:00.000Z',
            requestedBy: `admin:${ADMIN_UID}`,
            status: 'requested',
          };
          if (bumpsUpdatedAt) order().updatedAt = '2026-11-17T10:00:00.000Z';
        },
      };
      const result = await startAutomaticRefund(ORDER_ID, paystack.deps);
      assertEquals(result?.kind, 'changed', `bumpsUpdatedAt=${bumpsUpdatedAt}`);
      assertEquals(paystack.calls.length, 0, 'the auto refund never reached Paystack');
      assertEquals(execution()?.requestedBy, `admin:${ADMIN_UID}`, 'the admin claim stands');
    });
  }
});

Deno.test('a retry racing another retry after a failure: only one new attempt is sent', async () => {
  await withHarness(async () => {
    const failed = { amount: CAPTURED, attempt: 1, reference: REF_1, status: 'failed', lastError: 'Insufficient balance' };
    setup(makeOrder({ payment: refundedPayment({ refundExecution: failed }) }));
    const paystack = fakePaystack(accepted());
    const results = await Promise.all([
      sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps),
      startAutomaticRefund(ORDER_ID, paystack.deps),
    ]);
    assertEquals(paystack.calls.length, 1);
    assertEquals(results.map((result) => result?.kind).sort(), ['changed', 'sent']);
    assertEquals(execution()?.attempt, 2);
  });
});

Deno.test('a refund in any state but failed is never started again', async () => {
  for (const status of ['requested', 'pending', 'processing', 'processed', 'needs_attention', 'something_unknown']) {
    await withHarness(async () => {
      setup(makeOrder({ payment: refundedPayment({ refundExecution: { attempt: 1, reference: REF_1, status } }) }));
      const paystack = fakePaystack(accepted());
      const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
      assertEquals(result, { kind: 'refused', reason: 'already_started' }, status);
      assertEquals(paystack.calls.length, 0, status);
    });
  }
});

Deno.test('after a failed attempt a retry is a new attempt with a new reference', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        payment: refundedPayment({
          refundExecution: { amount: CAPTURED, attempt: 1, reference: REF_1, status: 'failed', lastError: 'Insufficient balance' },
        }),
      })
    );
    const paystack = fakePaystack(accepted('processing'));
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps);
    assertEquals(result.kind, 'sent');
    assertEquals(paystack.calls.length, 1);
    assertEquals(paystack.calls[0].reference, REF_2);
    assertEquals(execution()?.attempt, 2);
    assertEquals(execution()?.status, 'processing');
    assertEquals(execution()?.lastError, null);
  });
});

// ───────────────────── the amount cap ─────────────────────

Deno.test('the amount sent is the recorded refundAmount in kobo, not the captured total', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundAmount: 2150.5 }) }));
    const paystack = fakePaystack(accepted());
    await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(paystack.calls[0].amountKobo, 215050);
    assertEquals(paystack.calls[0].transactionReference, TX_REFERENCE);
    assertEquals(execution()?.amount, 2150.5);
  });
});

Deno.test('a refund above what the order captured, or above the Paystack charge, is refused', async () => {
  const cases: Array<[string, Row]> = [
    ['refund above captured', refundedPayment({ refundAmount: CAPTURED + 0.01 })],
    ['no captured amount to cap against', refundedPayment({ capturedAmount: undefined })],
    ['refund above the Paystack charge', refundedPayment({ paystackResponse: { amount: CAPTURED * 100 - 1 } })],
    ['zero refund', refundedPayment({ refundAmount: 0 })],
    ['missing refund amount', refundedPayment({ refundAmount: undefined })],
  ];
  for (const [label, payment] of cases) {
    await withHarness(async () => {
      setup(makeOrder({ payment }));
      const paystack = fakePaystack(accepted());
      const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
      assertEquals(result.kind, 'refused', label);
      assertEquals(paystack.calls.length, 0, label);
      assertEquals(execution(), undefined, `${label}: nothing claimed`);
    });
  }
});

Deno.test('a group share refunds only its own captured share', async () => {
  await withHarness(async () => {
    // One 10,000 charge split across two orders: this order captured 4,300.
    setup(makeOrder({ payment: refundedPayment({ paystackResponse: { amount: 1_000_000 } }) }));
    const paystack = fakePaystack(accepted());
    await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(paystack.calls[0].amountKobo, CAPTURED * 100);
  });
});

// ───────────────────── uncaptured or unrecorded ─────────────────────

Deno.test('a payment never captured, never recorded as refunded, or not a Paystack payment is refused', async () => {
  const cases: Array<[string, Row, string]> = [
    ['recorded refund on money never taken', refundedPayment({ capturedAmount: 0, paidAt: null }), 'not_captured'],
    ['paid but no refund recorded', refundedPayment({ status: 'paid' }), 'not_recorded'],
    ['pending payment', refundedPayment({ status: 'pending', capturedAmount: 0, paidAt: null }), 'not_recorded'],
    ['cash order', refundedPayment({ method: 'cash', provider: 'cash_on_delivery' }), 'not_paystack'],
    ['no transaction reference', refundedPayment({ reference: '' }), 'no_reference'],
  ];
  for (const [label, payment, reason] of cases) {
    await withHarness(async () => {
      setup(makeOrder({ payment }));
      const paystack = fakePaystack(accepted());
      const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps);
      assertEquals(result, { kind: 'refused', reason }, label);
      assertEquals(paystack.calls.length, 0, label);
    });
  }
});

Deno.test('a payment whose record changed after the read is not claimed', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const paystack = fakePaystack(accepted());
    updateHook = {
      when: (table) => table === 'CustomerOrder',
      run: () => {
        order().payment.status = 'paid';
      },
    };
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'changed');
    assertEquals(paystack.calls.length, 0);
  });
});

Deno.test('an unknown order is reported, not thrown', async () => {
  await withHarness(async () => {
    setup();
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, fakePaystack(accepted()).deps);
    assertEquals(result, { kind: 'not_found' });
  });
});

// ───────────────────── Paystack's answer ─────────────────────

Deno.test('the real transport posts amount, our reference and the transaction to /refund', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
      fetchBodies.push({ body: String(init?.body ?? ''), url: String(input) });
      if (String(input).startsWith('https://api.paystack.co/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: true, message: 'Refund has been queued for processing', data: { id: 77, status: 'pending' } }), {
            status: 200,
          })
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' });
    assertEquals(result.kind, 'sent');
    const paystackCalls = fetchBodies.filter((call) => call.url === 'https://api.paystack.co/refund');
    assertEquals(paystackCalls.length, 1);
    const body = JSON.parse(paystackCalls[0].body);
    assertEquals(body.amount, CAPTURED * 100);
    assertEquals(body.reference, REF_1);
    assertEquals(body.transaction, TX_REFERENCE);
    assertEquals(body.currency, 'NGN');
    assertEquals(execution()?.paystackRefundId, '77');
  });
});

Deno.test('a definite refusal records failed, raises the alert, and allows a retry', async () => {
  await withHarness(async () => {
    setup(makeOrder({ needsAttention: false }));
    const paystack = fakePaystack({ httpStatus: 400, kind: 'rejected', message: 'Insufficient balance' });
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps);
    assertEquals(result.kind, 'failed');
    assertEquals(execution()?.status, 'failed');
    assertEquals(execution()?.lastError, 'Insufficient balance');
    assertEquals(order().needsAttention, true);
    assertEquals(alerts('refund_failed').length, 1);
    assertEquals(adminEmails('refund_failed').length, 1);
    assertEquals(order().payment.status, 'refunded', 'the refund record is untouched');

    const retry = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, fakePaystack(accepted()).deps);
    assertEquals(retry.kind, 'sent');
    assertEquals(execution()?.reference, REF_2);
  });
});

Deno.test('no usable answer is unconfirmed: needs attention, and never retried', async () => {
  for (const outcome of [
    { kind: 'unknown', message: 'Paystack request to /refund timed out after 10000ms.' },
    { httpStatus: 409, kind: 'rejected', message: 'A refund with reference already exists' },
  ] as PaystackOutcome[]) {
    await withHarness(async () => {
      setup(makeOrder({ needsAttention: false }));
      const paystack = fakePaystack(outcome);
      const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
      assertEquals(result.kind, 'unconfirmed');
      assertEquals(execution()?.status, 'needs_attention');
      assertEquals(order().needsAttention, true);
      assertEquals(alerts('refund_needs_attention').length, 1);

      const again = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps);
      assertEquals(again, { kind: 'refused', reason: 'already_started' });
      assertEquals(paystack.calls.length, 1);
    });
  }
});

Deno.test('a webhook that lands before the answer is recorded keeps its newer state', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const paystack = fakePaystack(async () => {
      // Paystack processes and calls the webhook before its API reply lands.
      const result = await applyRefundWebhook({
        amountKobo: CAPTURED * 100,
        paystackRefundId: null,
        reason: null,
        refundReference: REF_1,
        status: 'processed',
        transactionReference: TX_REFERENCE,
      });
      assertEquals(result.ignored, false);
      return accepted('pending', 999);
    });
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'sent');
    assertEquals(execution()?.status, 'processed', 'the stale "pending" reply did not overwrite processed');
    assertEquals(execution()?.paystackRefundId, '999', 'the refund id is filled in');
    assertEquals(customerPushes().length, 1);
  });
});

// ───────────────────── automatic refunds: flag + never throwing ─────────────────────

Deno.test('auto_refunds is off unless the flag row says on, and off when unreadable', async () => {
  assertEquals(await isAutoRefundEnabled(() => Promise.resolve({})), false);
  assertEquals(await isAutoRefundEnabled(() => Promise.resolve({ auto_refunds: false })), false);
  assertEquals(await isAutoRefundEnabled(() => Promise.resolve({ auto_refunds: true })), true);
  await withHarness(async () => {
    assertEquals(await isAutoRefundEnabled(() => Promise.reject(new Error('db down'))), false);
  });
});

Deno.test('startAutomaticRefund never throws, even when the database does', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    failAllReads = true;
    const paystack = fakePaystack(accepted());
    assertEquals(await startAutomaticRefund(ORDER_ID, paystack.deps), null);
    assertEquals(paystack.calls.length, 0);
  });
});

// ───────────────────── refund webhooks ─────────────────────

const pendingExecution = (overrides: Row = {}) => ({
  amount: CAPTURED,
  attempt: 1,
  failedAt: null,
  lastError: null,
  paystackRefundId: '3018284',
  processedAt: null,
  reference: REF_1,
  requestedAt: '2026-11-17T10:00:00.000Z',
  requestedBy: 'auto',
  status: 'pending',
  ...overrides,
});

const event = (status: string, overrides: Row = {}) => ({
  amountKobo: CAPTURED * 100,
  paystackRefundId: '3018284',
  reason: null,
  refundReference: REF_1,
  status,
  transactionReference: TX_REFERENCE,
  ...overrides,
});

Deno.test('refund.processed applies once: redelivery changes nothing and the customer is told once', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }) }));
    db.OperationalAlert.push({
      alertType: 'manual_refund_required',
      dedupeKey: `ops:manual_refund_required:${ORDER_ID}`,
      resolvedAt: null,
    });

    const first = await applyRefundWebhook(event('processed'));
    assertEquals(first, { changed: true, ignored: false, orderId: ORDER_ID, status: 'processed' });
    assertEquals(execution()?.status, 'processed');
    assertEquals(typeof execution()?.processedAt, 'string');
    assertEquals(order().needsAttention, false, 'the manual-refund flag is cleared');
    assertEquals(typeof alerts('manual_refund_required')[0].resolvedAt, 'string', 'the manual alert is resolved');
    assertEquals(events('refund_processed').length, 1);
    assertEquals(customerPushes().length, 1);
    assertEquals(customerPushes()[0].body.includes('₦4,300'), true, customerPushes()[0].body);

    for (let delivery = 0; delivery < 3; delivery += 1) {
      const again = await applyRefundWebhook(event('processed'));
      assertEquals(again, { changed: false, ignored: false, orderId: ORDER_ID, status: 'processed' });
    }
    // Late, out-of-order events after the final state change nothing either.
    await applyRefundWebhook(event('pending'));
    await applyRefundWebhook(event('failed', { reason: 'late' }));
    assertEquals(execution()?.status, 'processed');
    assertEquals(customerPushes().length, 1, 'told once');
    assertEquals(events('refund_processed').length, 1);
  });
});

Deno.test('two simultaneous deliveries of refund.processed notify once', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }) }));
    const results = await Promise.all([applyRefundWebhook(event('processed')), applyRefundWebhook(event('processed'))]);
    assertEquals(results.filter((result) => !result.ignored && result.changed).length, 1);
    assertEquals(customerPushes().length, 1);
  });
});

Deno.test('refund.processed keeps the flag when a customer report or a payment reversal still needs a human', async () => {
  for (const overrides of [
    { customerIssueReportedAt: '2026-11-17T09:10:00.000Z' },
    { timeline: { paymentReversedAt: '2026-11-17T09:20:00.000Z' } },
  ]) {
    await withHarness(async () => {
      setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }), ...overrides }));
      await applyRefundWebhook(event('processed'));
      assertEquals(execution()?.status, 'processed');
      assertEquals(order().needsAttention, true, JSON.stringify(overrides));
    });
  }
});

Deno.test('refund.failed records the reason, raises the flag and the alert, emails admins, once', async () => {
  await withHarness(async () => {
    setup(makeOrder({ needsAttention: false, payment: refundedPayment({ refundExecution: pendingExecution({ status: 'processing' }) }) }));
    const first = await applyRefundWebhook(event('failed', { reason: 'Customer bank rejected the credit' }));
    assertEquals(first, { changed: true, ignored: false, orderId: ORDER_ID, status: 'failed' });
    assertEquals(execution()?.status, 'failed');
    assertEquals(execution()?.lastError, 'Customer bank rejected the credit');
    assertEquals(order().needsAttention, true);
    assertEquals(alerts('refund_failed').length, 1);
    assertEquals(String(alerts('refund_failed')[0].details).includes('Customer bank rejected the credit'), true);
    assertEquals(adminEmails('refund_failed').length, 1);
    assertEquals(customerPushes().length, 0);

    const again = await applyRefundWebhook(event('failed', { reason: 'Customer bank rejected the credit' }));
    assertEquals(again.ignored === false && again.changed, false);
    assertEquals(adminEmails('refund_failed').length, 1, 'redelivery sends nothing');
    assertEquals(events('refund_failed').length, 1);
  });
});

Deno.test('refund.needs-attention then processing then processed walks forward', async () => {
  await withHarness(async () => {
    setup(makeOrder({ needsAttention: false, payment: refundedPayment({ refundExecution: pendingExecution() }) }));
    await applyRefundWebhook(event('needs-attention'));
    assertEquals(execution()?.status, 'needs_attention');
    assertEquals(order().needsAttention, true);
    assertEquals(alerts('refund_needs_attention').length, 1);
    await applyRefundWebhook(event('processing'));
    assertEquals(execution()?.status, 'processing');
    await applyRefundWebhook(event('pending'));
    assertEquals(execution()?.status, 'processing', 'an older stage never moves it back');
    await applyRefundWebhook(event('processed'));
    assertEquals(execution()?.status, 'processed');
    assertEquals(order().needsAttention, false);
  });
});

Deno.test('a refund FEASTY did not start, or an older attempt, is ignored', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution({ attempt: 2, reference: REF_2 }) }) }));
    // The failed first attempt's late event must not touch the second attempt.
    assertEquals(await applyRefundWebhook(event('processed', { refundReference: REF_1 })), {
      ignored: true,
      reason: 'not_our_refund',
    });
    // A refund made by hand from the Paystack dashboard.
    assertEquals(await applyRefundWebhook(event('processed', { refundReference: 'dashboard-made-ref' })), {
      ignored: true,
      reason: 'not_our_refund',
    });
    // A charge FEASTY knows nothing about.
    assertEquals(await applyRefundWebhook(event('processed', { transactionReference: 'T-UNKNOWN' })), {
      ignored: true,
      reason: 'not_our_refund',
    });
    assertEquals(await applyRefundWebhook(event('reversed')), { ignored: true, reason: 'unknown_status' });
    assertEquals(execution()?.status, 'pending');
    assertEquals(customerPushes().length, 0);
  });
});

Deno.test('two orders of one charge: the event applies only to the order whose refund it is', async () => {
  await withHarness(async () => {
    const otherRef = 'feasty_rf_0b7f2a5222224c3e9d1a8f6e2a1b3c4d_1';
    setup(
      makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }) }),
      makeOrder({
        id: OTHER_ORDER_ID,
        payment: refundedPayment({ refundExecution: pendingExecution({ paystackRefundId: '555', reference: otherRef }) }),
      })
    );
    await applyRefundWebhook(event('processed', { paystackRefundId: '555', refundReference: otherRef }));
    assertEquals(execution(OTHER_ORDER_ID)?.status, 'processed');
    assertEquals(execution(ORDER_ID)?.status, 'pending');
  });
});

Deno.test('an event without our reference matches by Paystack id, or by an unambiguous amount', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }) }));
    await applyRefundWebhook(event('processing', { refundReference: null }));
    assertEquals(execution()?.status, 'processing');
    await applyRefundWebhook(event('processed', { paystackRefundId: null, refundReference: null }));
    assertEquals(execution()?.status, 'processed');
  });
});
