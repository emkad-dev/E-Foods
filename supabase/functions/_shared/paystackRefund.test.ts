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
const { applyRefundWebhook, isAutoRefundEnabled, refundPaymentOnClosedOrder, sendOrderRefund, startAutomaticRefund } = await import(
  './paystackRefund.ts'
);
const { initiatePaystackRefund } = await import('./paystack.ts');
const { adminDomain } = await import('./domains/admin.ts');
const sendRefundRpc = adminDomain.handlers.adminSendOrderRefund;

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
// What api.paystack.co answers when the real transport is used.
let paystackResponder: () => Response = () =>
  new Response(JSON.stringify({ status: true, data: { id: 77, status: 'pending' } }), { status: 200 });

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
  paystackResponse: { amount: CAPTURED * 100, id: 555000, reference: TX_REFERENCE },
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
  paystackResponder = () =>
    new Response(JSON.stringify({ status: true, data: { id: 77, status: 'pending' } }), { status: 200 });
  db.AdminAuditLog = [];
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
    if (String(input).startsWith('https://api.paystack.co/refund?')) {
      return Promise.resolve(new Response(JSON.stringify({ status: true, data: [], meta: { pageCount: 1 } }), { status: 200 }));
    }
    if (String(input).startsWith('https://api.paystack.co/')) return Promise.resolve(paystackResponder());
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
const fakePaystack = (
  outcome: PaystackOutcome | (() => PaystackOutcome | Promise<PaystackOutcome>),
  // What GET /refund lists (the existing-refund check). Empty by default.
  listing: PaystackOutcome | (() => PaystackOutcome) = { data: [], kind: 'ok', meta: { pageCount: 1 } }
) => {
  const calls: InitiateInput[] = [];
  const listCalls: Array<{ from: string; page: number; perPage: number }> = [];
  return {
    calls,
    listCalls,
    deps: {
      initiate: async (input: InitiateInput) => {
        calls.push(input);
        return typeof outcome === 'function' ? await outcome() : outcome;
      },
      listRefunds: (input: { from: string; page: number; perPage: number }) => {
        listCalls.push(input);
        return Promise.resolve(typeof listing === 'function' ? listing() : listing);
      },
    },
  };
};

/** A refund row as GET /refund lists it, on this order's charge (id 555000). */
const listedRefund = (fields: Row): Row => ({ id: 1, transaction: 555000, status: 'processed', ...fields });
const listing = (rows: Row[]): PaystackOutcome => ({ data: rows as unknown as Row, kind: 'ok', meta: { pageCount: 1 } });

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
    setup(makeOrder({ payment: refundedPayment({ paystackResponse: { amount: 1_000_000, id: 555000 } }) }));
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
      if (String(input).startsWith('https://api.paystack.co/refund?')) {
        return Promise.resolve(new Response(JSON.stringify({ status: true, data: [], meta: { pageCount: 1 } }), { status: 200 }));
      }
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
    assertEquals(await applyRefundWebhook(event('processed', { paystackRefundId: '111', refundReference: REF_1 })), {
      ignored: true,
      reason: 'not_our_refund',
    });
    // A refund made by hand from the Paystack dashboard.
    assertEquals(await applyRefundWebhook(event('processed', { paystackRefundId: '222', refundReference: 'dashboard-made-ref' })), {
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
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution({ paystackRefundId: null }) }) }));
    await applyRefundWebhook(event('processed', { paystackRefundId: null, refundReference: null }));
    assertEquals(execution()?.status, 'processed');
  });
});

// ───────────────────── the admin RPC ─────────────────────

const rpcContext = (uid: string, role: string) => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

const callRpc = (role: string, data: Row) =>
  // deno-lint-ignore no-explicit-any
  (sendRefundRpc as any)({
    context: rpcContext(role === 'admin' ? ADMIN_UID : 'someone', role),
    data: { orderId: ORDER_ID, ...data },
    request: new Request('https://example.test/rpc', { method: 'POST' }),
  });

const rpcFailure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as { status?: number; message?: string };
  }
  throw new Error('expected the RPC to fail, but it succeeded');
};

const paystackRefundCalls = () => fetchBodies.filter((call) => call.url === 'https://api.paystack.co/refund');

Deno.test('adminSendOrderRefund: admin only, a note required, nothing sent otherwise', async () => {
  await withHarness(async () => {
    for (const role of ['restaurant', 'dispatch', 'customer']) {
      setup(makeOrder());
      const error = await rpcFailure(() => callRpc(role, { note: 'refund it' }));
      assertEquals(error.status, 403, role);
    }
    setup(makeOrder());
    const noNote = await rpcFailure(() => callRpc('admin', { note: '  ' }));
    assertEquals(noNote.status, 400);
    assertEquals(paystackRefundCalls().length, 0);
    assertEquals(execution(), undefined);
  });
});

Deno.test('adminSendOrderRefund sends once, audits it, and a second click is refused', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const response = await callRpc('admin', { note: 'Customer called, restaurant closed early' });
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.data.outcome, 'sent');
    assertEquals(body.data.refundExecution.status, 'pending');
    assertEquals(body.data.refundExecution.requestedBy, `admin:${ADMIN_UID}`);
    assertEquals(paystackRefundCalls().length, 1);
    assertEquals(JSON.parse(paystackRefundCalls()[0].body).amount, CAPTURED * 100);
    const audit = db.AdminAuditLog.filter((entry) => entry.action === 'order_refund_sent');
    assertEquals(audit.length, 1);
    assertEquals(audit[0].details.note, 'Customer called, restaurant closed early');
    assertEquals(events('admin_refund_sent').length, 1);
    assertEquals(events('admin_refund_sent')[0].note, 'Customer called, restaurant closed early');

    const again = await rpcFailure(() => callRpc('admin', { note: 'again' }));
    assertEquals(again.status, 412);
    assertEquals(paystackRefundCalls().length, 1, 'still one refund');
  });
});

Deno.test('adminSendOrderRefund: two simultaneous clicks, one refund and one 409', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const outcomes = await Promise.allSettled([
      callRpc('admin', { note: 'first' }),
      callRpc('admin', { note: 'second' }),
    ]);
    const statuses = outcomes
      .map((outcome) => (outcome.status === 'fulfilled' ? outcome.value.status : (outcome.reason as { status?: number }).status))
      .sort();
    assertEquals(statuses, [200, 409]);
    assertEquals(paystackRefundCalls().length, 1);
  });
});

Deno.test('adminSendOrderRefund refuses an unrecorded or uncaptured refund with 412', async () => {
  for (const payment of [refundedPayment({ status: 'paid' }), refundedPayment({ capturedAmount: 0, paidAt: null })]) {
    await withHarness(async () => {
      setup(makeOrder({ payment }));
      const error = await rpcFailure(() => callRpc('admin', { note: 'refund' }));
      assertEquals(error.status, 412);
      assertEquals(paystackRefundCalls().length, 0);
    });
  }
});

Deno.test('adminSendOrderRefund reports a Paystack refusal as failed, audited, retryable', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    paystackResponder = () => new Response(JSON.stringify({ status: false, message: 'Insufficient balance' }), { status: 400 });
    const response = await callRpc('admin', { note: 'refund' });
    const body = await response.json();
    assertEquals(body.data.outcome, 'failed');
    assertEquals(body.data.refundExecution.lastError, 'Insufficient balance');
    assertEquals(db.AdminAuditLog.length, 1);

    paystackResponder = () =>
      new Response(JSON.stringify({ status: true, data: { id: 78, status: 'processing' } }), { status: 200 });
    const retry = await callRpc('admin', { note: 'topped up the balance' });
    assertEquals((await retry.json()).data.refundExecution.attempt, 2);
    assertEquals(paystackRefundCalls().length, 2);
  });
});

// ───────────────────── money on a closed order ─────────────────────

const latePaid = (overrides: Row = {}) =>
  makeOrder({
    status: 'cancelled',
    payment: {
      method: 'bank_transfer',
      provider: 'paystack',
      reference: TX_REFERENCE,
      status: 'paid',
      capturedAmount: CAPTURED,
      paidAt: '2026-11-17T09:40:00.000Z',
      paystackResponse: { amount: CAPTURED * 100, id: 555000 },
    },
    ...overrides,
  });

Deno.test('a payment on a closed order: the refund is recorded first, then sent once', async () => {
  await withHarness(async () => {
    setup(latePaid());
    const paystack = fakePaystack(accepted());
    const result = await refundPaymentOnClosedOrder(ORDER_ID, paystack.deps);
    assertEquals(result?.kind, 'sent');
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().payment.refundAmount, CAPTURED);
    assertEquals(order().payment.lastEvent, 'payment_on_closed_order_full_refund');
    assertEquals(paystack.calls.length, 1);
    assertEquals(paystack.calls[0].amountKobo, CAPTURED * 100);

    // A second call (a redelivered webhook) records and sends nothing.
    assertEquals(await refundPaymentOnClosedOrder(ORDER_ID, paystack.deps), null);
    assertEquals(paystack.calls.length, 1);
  });
});

Deno.test('a payment on a closed order: a live order, an unpaid one, or a lost race is never refunded', async () => {
  const cases: Array<[string, Row]> = [
    ['live order', latePaid({ status: 'accepted' })],
    ['delivered order', latePaid({ status: 'delivered' })],
    ['not captured', latePaid({ payment: { ...latePaid().payment, capturedAmount: 0, paidAt: null } })],
  ];
  for (const [label, row] of cases) {
    await withHarness(async () => {
      setup(row);
      const paystack = fakePaystack(accepted());
      assertEquals(await refundPaymentOnClosedOrder(ORDER_ID, paystack.deps), null, label);
      assertEquals(paystack.calls.length, 0, label);
      assertEquals(order().payment.status, 'paid', label);
    });
  }
  await withHarness(async () => {
    setup(latePaid());
    const paystack = fakePaystack(accepted());
    updateHook = {
      when: (table) => table === 'CustomerOrder',
      run: () => {
        order().updatedAt = '2026-11-17T11:00:00.000Z';
      },
    };
    assertEquals(await refundPaymentOnClosedOrder(ORDER_ID, paystack.deps), null, 'lost race');
    assertEquals(paystack.calls.length, 0);
  });
});

// ───────────────────── refunds already at Paystack (never refund twice) ─────────────────────

Deno.test('a refund made by hand in the Paystack dashboard blocks ours: nothing is sent', async () => {
  for (const handRefund of [
    listedRefund({ reference: 'dashboard-ref-123', status: 'processed' }),
    listedRefund({ status: 'pending' }), // no reference at all
    listedRefund({ transaction: { id: 555000, reference: TX_REFERENCE }, reference: null, status: 'needs-attention' }),
  ]) {
    await withHarness(async () => {
      setup(makeOrder({ needsAttention: false }));
      const paystack = fakePaystack(accepted(), listing([handRefund]));
      const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps);
      assertEquals(result.kind, 'blocked', JSON.stringify(handRefund));
      assertEquals(paystack.calls.length, 0, 'no refund POST');
      assertEquals(execution()?.status, 'needs_attention');
      assertEquals(String(execution()?.lastError).startsWith('A refund already exists on this payment in Paystack'), true);
      assertEquals(execution()?.unconfirmed, false, 'not resendable');
      assertEquals(order().needsAttention, true);
      assertEquals(alerts('refund_needs_attention').length, 1);
    });
  }
});

Deno.test('only failed refunds, or another order FEASTY refund on the same charge, do not block', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const paystack = fakePaystack(
      accepted(),
      listing([
        listedRefund({ reference: 'dashboard-ref-123', status: 'failed' }),
        listedRefund({ reference: REF_1, status: 'failed' }),
        listedRefund({ reference: 'feasty_rf_0b7f2a5222224c3e9d1a8f6e2a1b3c4d_1', status: 'processed' }),
        // A refund on a different charge entirely.
        listedRefund({ reference: 'someone-else', status: 'processed', transaction: 999 }),
      ])
    );
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'sent');
    assertEquals(paystack.calls.length, 1);
    assertEquals(paystack.listCalls[0].from, '2026-11-16', 'listed from the day before the payment');
  });
});

Deno.test('an earlier attempt of this same order still alive at Paystack blocks a retry', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        payment: refundedPayment({ refundExecution: { amount: CAPTURED, attempt: 1, reference: REF_1, status: 'failed' } }),
      })
    );
    const paystack = fakePaystack(accepted(), listing([listedRefund({ reference: REF_1, status: 'processing' })]));
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, paystack.deps);
    assertEquals(result.kind, 'blocked');
    assertEquals(paystack.calls.length, 0);
  });
});

Deno.test('when Paystack cannot be checked, nothing is sent', async () => {
  const cases: Array<[string, Row, PaystackOutcome]> = [
    ['lookup timed out', refundedPayment(), { kind: 'unknown', message: 'Paystack request to /refund timed out after 10000ms.' }],
    ['lookup refused', refundedPayment(), { httpStatus: 401, kind: 'rejected', message: 'Invalid key' }],
    ['unreadable list', refundedPayment(), { data: { not: 'an array' }, kind: 'ok' }],
    ['no charge id stored', refundedPayment({ paystackResponse: { amount: CAPTURED * 100 } }), listing([])],
    ['no payment date', refundedPayment({ paidAt: null, capturedAmount: CAPTURED }), listing([])],
  ];
  for (const [label, payment, list] of cases) {
    await withHarness(async () => {
      setup(makeOrder({ payment, needsAttention: false }));
      const paystack = fakePaystack(accepted(), list);
      const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
      assertEquals(result.kind, 'unconfirmed', label);
      assertEquals(paystack.calls.length, 0, `${label}: no refund POST`);
      assertEquals(execution()?.status, 'needs_attention', label);
      assertEquals(String(execution()?.lastError).includes('Nothing was sent'), true, label);
      assertEquals(order().needsAttention, true, label);
    });
  }
});

Deno.test('the lookup pages through every page of refunds since the payment', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    let page = 0;
    const paystack = fakePaystack(accepted(), () => {
      page += 1;
      return {
        data: (page === 2 ? [listedRefund({ reference: 'dashboard-ref', status: 'processed' })] : []) as unknown as Row,
        kind: 'ok',
        meta: { pageCount: 3 },
      };
    });
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'blocked', 'the hand refund on page 2 was found');
    assertEquals(paystack.calls.length, 0);
  });
});

// ───────────────────── marked refunded by hand ─────────────────────

Deno.test('mark_manual: processed + manual, flag cleared, audited, no Paystack call and no customer push', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    db.OperationalAlert.push({ alertType: 'manual_refund_required', dedupeKey: `ops:manual_refund_required:${ORDER_ID}`, resolvedAt: null });
    const response = await callRpc('admin', { mode: 'mark_manual', note: 'Refunded from the Paystack dashboard on Monday' });
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.data.outcome, 'marked_manual');
    assertEquals(execution()?.status, 'processed');
    assertEquals(execution()?.manual, true);
    assertEquals(execution()?.requestedBy, `admin:${ADMIN_UID}`);
    assertEquals(typeof execution()?.processedAt, 'string');
    assertEquals(order().needsAttention, false);
    assertEquals(typeof alerts('manual_refund_required')[0].resolvedAt, 'string');
    assertEquals(paystackRefundCalls().length, 0);
    assertEquals(customerPushes().length, 0);
    const audit = db.AdminAuditLog.filter((entry) => entry.action === 'order_refund_marked_manual');
    assertEquals(audit.length, 1);
    assertEquals(audit[0].details.note, 'Refunded from the Paystack dashboard on Monday');

    // Afterwards a Paystack refund is refused for good.
    const again = await rpcFailure(() => callRpc('admin', { note: 'send it' }));
    assertEquals(again.status, 412);
    assertEquals(paystackRefundCalls().length, 0);
  });
});

Deno.test('mark_manual is refused while a Paystack refund is in flight, and needs a note', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: { attempt: 1, reference: REF_1, status: 'pending' } }) }));
    const error = await rpcFailure(() => callRpc('admin', { mode: 'mark_manual', note: 'paid' }));
    assertEquals(error.status, 412);
    assertEquals(execution()?.status, 'pending');
    const noNote = await rpcFailure(() => callRpc('admin', { mode: 'mark_manual', note: '' }));
    assertEquals(noNote.status, 400);
  });
});

Deno.test('mark_manual works on a legacy refund flagged by the backfill, which is never sent through Paystack', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        payment: refundedPayment({
          refundExecution: { status: 'needs_attention', requestedBy: 'legacy', lastError: 'Refunded before Paystack refunds existed' },
        }),
      })
    );
    const send = await rpcFailure(() => callRpc('admin', { note: 'send' }));
    assertEquals(send.status, 412);
    const response = await callRpc('admin', { mode: 'mark_manual', note: 'checked Paystack, already refunded' });
    assertEquals(response.status, 200);
    assertEquals(execution()?.manual, true);
  });
});

Deno.test('a Paystack refund event on an order marked refunded by hand raises a paid-twice alert', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: { ...pendingExecution(), status: 'processed', manual: true } }) }));
    await applyRefundWebhook(event('processed'));
    assertEquals(db.OperationalAlert.filter((alert) => alert.dedupeKey === `ops:refund_paid_twice:${ORDER_ID}`).length, 1);
    assertEquals(customerPushes().length, 0);
  });
});

// ───────────────────── unmatched refund webhooks ─────────────────────

const unmatchedAlerts = () => alerts('refund_webhook_unmatched');

Deno.test('a reference miss falls through to the Paystack refund id', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }) }));
    const result = await applyRefundWebhook(event('processed', { refundReference: 'FEASTY-something-else' }));
    assertEquals(result, { changed: true, ignored: false, orderId: ORDER_ID, status: 'processed' });
    assertEquals(unmatchedAlerts().length, 0);
  });
});

Deno.test('the amount fallback is used only with no reference and no Paystack id stored yet', async () => {
  await withHarness(async () => {
    // Our attempt already has a Paystack id: a reference-less event with another id must not match on amount.
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }) }));
    const result = await applyRefundWebhook(event('processed', { paystackRefundId: '999', refundReference: null }));
    assertEquals(result, { ignored: true, reason: 'not_our_refund' });
    assertEquals(execution()?.status, 'pending');
    assertEquals(unmatchedAlerts().length, 1);
  });
  await withHarness(async () => {
    // An event carrying some other reference never matches on amount.
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution({ paystackRefundId: null }) }) }));
    const result = await applyRefundWebhook(event('processed', { paystackRefundId: null, refundReference: 'dashboard-ref' }));
    assertEquals(result, { ignored: true, reason: 'not_our_refund' });
    assertEquals(execution()?.status, 'pending');
  });
  await withHarness(async () => {
    // No reference, no stored id, the same amount: matched.
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution({ paystackRefundId: null }) }) }));
    const result = await applyRefundWebhook(event('processing', { paystackRefundId: '42', refundReference: null }));
    assertEquals(result.ignored, false);
    assertEquals(execution()?.status, 'processing');
    assertEquals(execution()?.paystackRefundId, '42');
  });
});

Deno.test('an unmatched refund on a charge with a refund in flight raises refund_webhook_unmatched, once per refund', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }) }));
    for (let delivery = 0; delivery < 2; delivery += 1) {
      const result = await applyRefundWebhook(event('processed', { paystackRefundId: '7777', refundReference: 'dashboard-ref' }));
      assertEquals(result, { ignored: true, reason: 'not_our_refund' }, 'answered 200, ignored');
    }
    assertEquals(unmatchedAlerts().length, 1, 'deduplicated');
    const alert = unmatchedAlerts()[0];
    assertEquals(alert.metadata.refundReference, 'dashboard-ref');
    assertEquals(alert.metadata.paystackRefundId, '7777');
    assertEquals(alert.metadata.status, 'processed');
    assertEquals(alert.subjectId, ORDER_ID);
    assertEquals(execution()?.status, 'pending');
  });
});

Deno.test('an unmatched refund on a charge with nothing in flight is ignored quietly', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution({ status: 'processed' }) }) }));
    await applyRefundWebhook(event('processed', { paystackRefundId: '7777', refundReference: 'dashboard-ref' }));
    setup(makeOrder());
    await applyRefundWebhook(event('processed', { paystackRefundId: '7777', refundReference: 'dashboard-ref' }));
    assertEquals(unmatchedAlerts().length, 0);
  });
});

// ───────────────────── resuming a stuck or unconfirmed attempt ─────────────────────

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const stuck = (overrides: Row = {}) => ({
  amount: CAPTURED,
  attempt: 1,
  reference: REF_1,
  requestedAt: minutesAgo(11),
  requestedBy: 'auto',
  status: 'requested',
  ...overrides,
});

Deno.test('a requested claim older than 10 minutes is resent with the SAME reference', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: stuck() }) }));
    const paystack = fakePaystack(accepted());
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'sent');
    assertEquals(paystack.calls.length, 1);
    assertEquals(paystack.calls[0].reference, REF_1, 'same reference, never a new one');
    assertEquals(execution()?.attempt, 1);
    assertEquals(execution()?.status, 'pending');
  });
});

Deno.test('a requested claim under 10 minutes old is refused', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: stuck({ requestedAt: minutesAgo(9) }) }) }));
    const paystack = fakePaystack(accepted());
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}`, allowUnconfirmed: true }, paystack.deps);
    assertEquals(result, { kind: 'refused', reason: 'already_started' });
    assertEquals(paystack.calls.length, 0);
  });
});

Deno.test('two concurrent resumes of the same stale claim send once', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: stuck() }) }));
    const paystack = fakePaystack(accepted());
    const results = await Promise.all([
      sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps),
      sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}`, allowUnconfirmed: true }, paystack.deps),
    ]);
    assertEquals(paystack.calls.length, 1);
    assertEquals(results.map((result) => result.kind).sort(), ['changed', 'sent']);
  });
});

Deno.test('concurrent resumes that both pass the status check are separated by requestedAt', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: stuck() }) }));
    const paystack = fakePaystack(accepted());
    // Another resume's claim lands first: still 'requested', same reference, new requestedAt.
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.payment?.refundExecution?.status === 'requested',
      run: () => {
        order().payment.refundExecution = stuck({ requestedAt: new Date().toISOString(), requestedBy: 'admin:other' });
      },
    };
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'changed');
    assertEquals(paystack.calls.length, 0);
  });
});

Deno.test('a resend that finds its own reference at Paystack adopts it instead of posting', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: stuck() }) }));
    const paystack = fakePaystack(accepted(), listing([listedRefund({ id: 4242, reference: REF_1, status: 'processing' })]));
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'sent');
    assertEquals(paystack.calls.length, 0, 'no second POST');
    assertEquals(execution()?.status, 'processing');
    assertEquals(execution()?.paystackRefundId, '4242');
  });
});

Deno.test('a resend answered 409 stays needs_attention (unconfirmed)', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: stuck() }) }));
    const paystack = fakePaystack({ httpStatus: 409, kind: 'rejected', message: 'A refund with reference already exists' });
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'unconfirmed');
    assertEquals(execution()?.status, 'needs_attention');
    assertEquals(execution()?.unconfirmed, true);
    assertEquals(execution()?.reference, REF_1);
  });
});

Deno.test('an unconfirmed needs_attention is resent by an admin with the same reference, never by the automatic path', async () => {
  const unconfirmed = () =>
    makeOrder({
      payment: refundedPayment({
        refundExecution: stuck({ requestedAt: minutesAgo(1), status: 'needs_attention', unconfirmed: true, lastError: 'timed out' }),
      }),
    });
  await withHarness(async () => {
    setup(unconfirmed());
    const paystack = fakePaystack(accepted());
    assertEquals(await startAutomaticRefund(ORDER_ID, paystack.deps), { kind: 'refused', reason: 'already_started' });
    assertEquals(paystack.calls.length, 0);
  });
  await withHarness(async () => {
    setup(unconfirmed());
    const response = await callRpc('admin', { note: 'checked Paystack, nothing there' });
    const body = await response.json();
    assertEquals(body.data.outcome, 'sent');
    assertEquals(JSON.parse(paystackRefundCalls()[0].body).reference, REF_1);
    assertEquals(execution()?.attempt, 1);
  });
  await withHarness(async () => {
    // Paystack's own needs-attention (bank details missing) is never resent.
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution({ status: 'needs_attention' }) }) }));
    const error = await rpcFailure(() => callRpc('admin', { note: 'resend' }));
    assertEquals(error.status, 412);
  });
});

// ───────────────────── what the apps read ─────────────────────

Deno.test('order reads for the apps reduce the refund execution to status and amount', async () => {
  const { toOrderSnapshotResponse } = await import('./orders.ts');
  const row = makeOrder({
    payment: refundedPayment({
      refundExecution: {
        ...pendingExecution(),
        lastError: 'Insufficient balance',
        requestedBy: `admin:${ADMIN_UID}`,
        status: 'failed',
      },
    }),
  });
  // deno-lint-ignore no-explicit-any
  const snapshot = toOrderSnapshotResponse(row as any, [], null) as Row;
  assertEquals(snapshot.payment.refundExecution, { amount: CAPTURED, status: 'failed' });
  assertEquals(snapshot.payment.refundAmount, CAPTURED, 'the rest of the payment is kept');
  assertEquals(JSON.stringify(snapshot).includes(ADMIN_UID), false, 'no admin uid');
  assertEquals(JSON.stringify(snapshot).includes('Insufficient balance'), false, 'no Paystack error text');
  assertEquals(JSON.stringify(snapshot).includes(REF_1), false, 'no refund reference');

  // deno-lint-ignore no-explicit-any
  const plain = toOrderSnapshotResponse(makeOrder() as any, [], null) as Row;
  assertEquals(plain.payment.refundExecution, undefined, 'no execution, nothing added');
});

// ───────────────────── other payment changes are never overwritten ─────────────────────

Deno.test('recording Paystack answer never overwrites a payment change made meanwhile', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const paystack = fakePaystack(accepted('processing'));
    // Just before the outcome write lands, another writer changes a payment field.
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.payment?.refundExecution?.status === 'processing',
      run: () => {
        order().payment.lastEvent = 'reconciled_by_ops';
        order().updatedAt = '2026-11-17T12:34:56.000Z';
      },
    };
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'sent');
    assertEquals(execution()?.status, 'processing', 're-applied after the lost guard');
    assertEquals(order().payment.lastEvent, 'reconciled_by_ops', 'the other change survives');
  });
});

Deno.test('a refund webhook never overwrites a payment change made meanwhile', async () => {
  await withHarness(async () => {
    setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution() }) }));
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.payment?.refundExecution?.status === 'processed',
      run: () => {
        order().payment.lastEvent = 'reconciled_by_ops';
        order().updatedAt = '2026-11-17T12:34:56.000Z';
      },
    };
    const result = await applyRefundWebhook(event('processed'));
    assertEquals(result, { changed: true, ignored: false, orderId: ORDER_ID, status: 'processed' });
    assertEquals(order().payment.lastEvent, 'reconciled_by_ops');
    assertEquals(execution()?.status, 'processed');
    assertEquals(customerPushes().length, 1, 'still told once');
  });
});

Deno.test('a live listed refund that names no charge is a lookup error: nothing is sent', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const paystack = fakePaystack(accepted(), listing([{ id: 9, reference: 'mystery', status: 'processed' }]));
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'unconfirmed');
    assertEquals(paystack.calls.length, 0);
    assertEquals(execution()?.status, 'needs_attention');
  });
  await withHarness(async () => {
    // The same row, failed, credits the money back and is ignored.
    setup(makeOrder());
    const paystack = fakePaystack(accepted(), listing([{ id: 9, reference: 'mystery', status: 'failed' }]));
    const result = await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(result.kind, 'sent');
  });
});

Deno.test('a same-amount hand refund never attaches to a needs_attention attempt: it raises refund_webhook_unmatched', async () => {
  for (const fields of [{ status: 'needs_attention' }, { status: 'needs_attention', unconfirmed: true }]) {
    await withHarness(async () => {
      setup(makeOrder({ payment: refundedPayment({ refundExecution: pendingExecution({ paystackRefundId: null, ...fields }) }) }));
      const result = await applyRefundWebhook(event('processed', { paystackRefundId: '8888', refundReference: null }));
      assertEquals(result, { ignored: true, reason: 'not_our_refund' }, JSON.stringify(fields));
      assertEquals(execution()?.status, 'needs_attention', 'not attached');
      assertEquals(execution()?.paystackRefundId, null);
      assertEquals(alerts('refund_webhook_unmatched').length, 1);
      assertEquals(customerPushes().length, 0);
    });
  }
});

Deno.test('timeout, then processing, then needs-attention: Paystack has the refund, so it is never resent', async () => {
  await withHarness(async () => {
    setup(makeOrder());
    const timedOut = fakePaystack({ kind: 'unknown', message: 'Paystack request to /refund timed out after 10000ms.' });
    await sendOrderRefund({ orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` }, timedOut.deps);
    assertEquals(execution()?.unconfirmed, true);

    await applyRefundWebhook(event('processing', { paystackRefundId: '6060' }));
    assertEquals(execution()?.status, 'processing');
    assertEquals(execution()?.unconfirmed, false);
    assertEquals(execution()?.paystackRefundId, '6060');

    await applyRefundWebhook(event('needs-attention', { paystackRefundId: '6060' }));
    assertEquals(execution()?.status, 'needs_attention');
    assertEquals(execution()?.unconfirmed, false, 'Paystack needs bank details: not a resendable timeout');
    assertEquals(execution()?.paystackRefundId, '6060');

    const resend = fakePaystack(accepted());
    const result = await sendOrderRefund(
      { allowUnconfirmed: true, orderId: ORDER_ID, requestedBy: `admin:${ADMIN_UID}` },
      resend.deps
    );
    assertEquals(result, { kind: 'refused', reason: 'already_started' });
    assertEquals(resend.calls.length, 0);
  });
});

Deno.test('a resend claim keeps a Paystack id already learned', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        payment: refundedPayment({
          refundExecution: {
            amount: CAPTURED,
            attempt: 1,
            paystackRefundId: '7070',
            reference: REF_1,
            requestedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
            requestedBy: 'auto',
            status: 'requested',
          },
        }),
      })
    );
    let idDuringSend: unknown = 'unset';
    const paystack = fakePaystack(() => {
      idDuringSend = execution()?.paystackRefundId;
      return { httpStatus: 409, kind: 'rejected', message: 'A refund with reference already exists' };
    });
    await sendOrderRefund({ orderId: ORDER_ID, requestedBy: 'auto' }, paystack.deps);
    assertEquals(idDuringSend, '7070', 'the claim did not wipe it');
    assertEquals(execution()?.paystackRefundId, '7070');
  });
});
