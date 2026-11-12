// Payment state integrity (order-flow fixes, Spec 5 and 6). Drives the REAL
// customer refresh (ordersDomain.handlers.refreshCustomerPaymentStatus), the
// REAL webhook path (handlePaymentVerification), the REAL unpaid expiry sweep
// (sweepUnpaidOrders) and the lazy expiry on read (maybeExpireUnpaidOrder)
// against one in-memory fake of the tables they touch, and asserts the STORED
// rows: order and payment status, needsAttention, the ledger, DeliveryEvents,
// alerts and queued notifications.
//
// Races are staged with a one-shot hook that runs just before an UPDATE is
// evaluated - the moment a concurrent writer's commit would land between a
// caller's read and its compare-and-set. The fake applies every filter of the
// UPDATE together, after the hook, the way Postgres re-evaluates the WHERE of an
// UPDATE against the committed row once it holds the row lock.
//
// Paystack is never called: globalThis.fetch is stubbed for every test.
//
// Runs in package.json's --no-check `deno test` group: the domain modules
// import _shared/client.ts, which throws at module scope without these env vars.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');
Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_not_real');

import { assertEquals } from 'jsr:@std/assert';

const { serviceClient } = await import('./client.ts');
const { ordersDomain } = await import('./domains/orders.ts');
const { handlePaymentVerification } = await import('../payment-verification/handler.ts');
const { sweepUnpaidOrders } = await import('./unpaidOrderExpirySweep.ts');
const { maybeExpireUnpaidOrder } = await import('./orders.ts');

const refreshCustomerPaymentStatus = ordersDomain.handlers.refreshCustomerPaymentStatus;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type UpdateHook = (table: string, payload: Row, filterLabels: string[]) => Promise<void> | void;

let db: Record<string, Row[]> = {};
let paystackVerifyData: Row | null = null;
let paystackVerifyCalls = 0;
let rpcCalls: Array<{ fn: string; params: Row }> = [];
let beforeUpdate: UpdateHook | null = null;

const MINUTE = 60_000;
const REFERENCE = 'FEASTY-CRD-INTEGRITY-1';

// A PostgREST column, including a JSON path like 'payment->>status' (text, or
// null when absent).
const readColumn = (row: Row, column: string): unknown => {
  const [base, key] = column.split('->>');
  if (key === undefined) return row[base];
  const value = (row[base] ?? {})[key];
  return value === undefined || value === null ? null : String(value);
};

const makeBuilder = (table: string) => {
  const filters: Array<(row: Row) => boolean> = [];
  const filterLabels: string[] = [];
  let op: 'select' | 'update' | 'upsert' | 'insert' | 'delete' = 'select';
  let payload: Row | Row[] | null = null;
  let upsertConflict: string | null = null;
  let orderColumn: string | null = null;
  let orderAscending = true;
  let limitCount: number | null = null;

  const execute = async (mode: 'single' | 'maybeSingle' | 'many') => {
    if (op === 'update' && beforeUpdate) {
      const hook = beforeUpdate;
      beforeUpdate = null;
      await hook(table, payload as Row, filterLabels.slice());
    }

    const rows = (db[table] ??= []);
    const matches = rows.filter((row) => filters.every((filter) => filter(row)));

    if (op === 'select') {
      let result = matches;
      if (orderColumn) {
        const column = orderColumn;
        result = [...result].sort((a, b) => {
          const cmp = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
          return orderAscending ? cmp : -cmp;
        });
      }
      if (limitCount !== null) result = result.slice(0, limitCount);
      const data = result.map((row) => structuredClone(row));
      if (mode === 'many') return { data, error: null };
      if (mode === 'single' && data.length !== 1) return { data: null, error: { message: 'single row expected' } };
      return { data: data[0] ?? null, error: null };
    }

    if (op === 'update') {
      for (const row of matches) Object.assign(row, structuredClone(payload));
      const data = matches.map((row) => structuredClone(row));
      return { data: mode === 'many' ? data : (data[0] ?? null), error: null };
    }
    if (op === 'insert') {
      for (const item of Array.isArray(payload) ? payload : [payload]) rows.push(structuredClone(item as Row));
      return { data: null, error: null };
    }
    if (op === 'upsert') {
      const key = upsertConflict ?? 'id';
      const item = payload as Row;
      const existing = rows.find((row) => row[key] === item[key]);
      if (existing) Object.assign(existing, structuredClone(item));
      else rows.push(structuredClone(item));
      return { data: null, error: null };
    }
    db[table] = rows.filter((row) => !matches.includes(row));
    return { data: null, error: null };
  };

  const addFilter = (label: string, filter: (row: Row) => boolean) => {
    filters.push(filter);
    filterLabels.push(label);
    return builder;
  };

  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) =>
      addFilter(`${column}=${String(value)}`, (row) => readColumn(row, column) === value),
    neq: (column: string, value: unknown) =>
      addFilter(`${column}!=${String(value)}`, (row) => readColumn(row, column) !== value),
    in: (column: string, values: unknown[]) =>
      addFilter(`${column} in (${values.join(',')})`, (row) => values.includes(readColumn(row, column))),
    is: (column: string, value: unknown) =>
      addFilter(`${column} is ${String(value)}`, (row) => (readColumn(row, column) ?? null) === value),
    lt: (column: string, value: unknown) =>
      addFilter(`${column}<${String(value)}`, (row) => {
        const cell = readColumn(row, column);
        return cell !== null && cell !== undefined && (cell as string) < (value as string);
      }),
    order: (column: string, options?: { ascending?: boolean }) => {
      orderColumn = column;
      orderAscending = options?.ascending !== false;
      return builder;
    },
    limit: (count: number) => {
      limitCount = count;
      return builder;
    },
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

const makeOrder = (overrides: Row = {}): Row => ({
  id: 'order-1',
  customerId: 'cust-1',
  restaurantId: 'rest-1',
  restaurantName: 'Test Kitchen',
  orderGroupId: null,
  status: 'placed',
  fulfillmentType: 'pickup',
  needsAttention: false,
  payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'pending' },
  pricing: { total: 2500 },
  timeline: { placedAt: new Date(Date.now() - 2 * MINUTE).toISOString() },
  cancellation: null,
  createdAt: new Date(Date.now() - 2 * MINUTE).toISOString(),
  updatedAt: new Date(Date.now() - 2 * MINUTE).toISOString(),
  ...overrides,
});

const pendingTransaction = (overrides: Row = {}): Row => ({
  id: REFERENCE,
  reference: REFERENCE,
  orderId: 'order-1',
  customerId: 'cust-1',
  restaurantId: 'rest-1',
  method: 'card',
  amount: 2500,
  status: 'pending',
  ...overrides,
});

const setup = (orders: Row[], transactions: Row[] = [pendingTransaction()]) => {
  db = {
    CustomerOrder: orders.map((order) => structuredClone(order)),
    OrderGroup: [],
    OrderItem: [],
    DeliveryAssignment: [],
    DeliveryEvent: [],
    PaymentTransaction: transactions.map((row) => structuredClone(row)),
    IdempotencyRecord: [],
    OperationalAlert: [],
    UserRole: [{ userId: 'partner-user-1', role: 'restaurant', restaurantId: 'rest-1' }],
    UserAccount: [],
    queue_notifications: [],
  };
  rpcCalls = [];
  paystackVerifyCalls = 0;
  beforeUpdate = null;
};

const withHarness = async (work: () => Promise<void>) => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => makeBuilder(table);
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = (fn: string, params: Row) => {
    rpcCalls.push({ fn, params });
    return Promise.resolve({ data: [], error: null });
  };
  globalThis.fetch = ((input: unknown) => {
    const url = String(input);
    if (url.startsWith('https://api.paystack.co/transaction/verify/')) {
      paystackVerifyCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ status: true, data: structuredClone(paystackVerifyData) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
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
    beforeUpdate = null;
  }
};

const charge = (status: string, overrides: Row = {}): Row => ({
  id: 987654,
  amount: 250000,
  reference: REFERENCE,
  status,
  gateway_response: status === 'success' ? 'Successful' : status,
  channel: 'card',
  ...overrides,
});

const customerContext = {
  email: 'cust-1@example.test',
  role: 'customer',
  token: 'fake-token',
  uid: 'cust-1',
  userProfile: { uid: 'cust-1', email: 'cust-1@example.test', role: 'customer', accountDisabled: false },
};

const refresh = async (orderId = 'order-1') => {
  const response = await refreshCustomerPaymentStatus({
    context: customerContext,
    data: { orderId },
    request: new Request('https://example.test/rpc', { method: 'POST' }),
  } as never);
  return { status: response.status, body: (await response.json()) as { data: Row } };
};

const webhook = () => handlePaymentVerification({ orderId: 'order-1', paymentReference: REFERENCE } as never);

const order = (id = 'order-1') => {
  const row = db.CustomerOrder.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`order ${id} missing from fake db`);
  return row;
};
const events = (type: string) => db.DeliveryEvent.filter((event) => event.eventType === type);
const notifications = (app: string, type: string) =>
  db.queue_notifications.filter((job) => job.payload?.payload?.data?.app === app && job.payload?.payload?.data?.type === type);
const releaseCalls = () => rpcCalls.filter((call) => call.fn === 'ebuy_release_promo_redemption');

// ───────────────────────── Spec 5: one verification path ─────────────────────────

Deno.test('refresh: money captured on a cancelled order is recorded, flagged and alerted, and the restaurant is not told', async () => {
  await withHarness(async () => {
    setup([
      makeOrder({
        status: 'cancelled',
        payment: {
          method: 'card',
          provider: 'paystack',
          reference: REFERENCE,
          status: 'failed',
          lastEvent: 'payment_timeout',
        },
        cancellation: { actor: 'system', reason: 'payment_timeout' },
        timeline: { placedAt: '2026-11-09T10:00:00.000Z', cancelledAt: '2026-11-09T10:15:00.000Z' },
      }),
    ]);
    paystackVerifyData = charge('success');

    const { status, body } = await refresh();

    assertEquals(status, 200);
    assertEquals(body.data.paymentStatus, 'paid');
    assertEquals(body.data.status, 'cancelled');
    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'paid');
    assertEquals(order().needsAttention, true);
    assertEquals(typeof order().timeline.latePaymentAt, 'string');
    assertEquals(order().timeline.cancelledAt, '2026-11-09T10:15:00.000Z');
    assertEquals('refundAmount' in order().payment, false);
    assertEquals(db.OperationalAlert.map((alert) => alert.alertType), ['payment_on_closed_order']);
    assertEquals(events('payment_received_on_closed_order').length, 1);
    assertEquals(events('payment_confirmed').length, 0);
    assertEquals(db.queue_notifications.length, 0);
    assertEquals(db.PaymentTransaction[0].status, 'paid');
    // One Paystack call: the refresh hands its answer to the shared path.
    assertEquals(paystackVerifyCalls, 1);
  });
});

Deno.test('refresh: a refunded payment is never turned back into paid', async () => {
  await withHarness(async () => {
    const refunded = {
      method: 'card',
      provider: 'paystack',
      reference: REFERENCE,
      status: 'refunded',
      capturedAmount: 2500,
      refundAmount: 2500,
      refundedAt: '2026-11-09T11:00:00.000Z',
    };
    setup([makeOrder({ status: 'cancelled', payment: refunded })], [pendingTransaction({ status: 'refunded' })]);
    paystackVerifyData = charge('success');

    const { status, body } = await refresh();

    assertEquals(status, 200);
    assertEquals(body.data.paymentStatus, 'refunded');
    assertEquals(order().payment, refunded);
    assertEquals(order().needsAttention, false);
    assertEquals(db.PaymentTransaction[0].status, 'refunded');
    assertEquals(db.queue_notifications.length, 0);
    assertEquals(db.DeliveryEvent.length, 0);
  });
});

Deno.test('refresh: a later failed or abandoned verify never downgrades a paid payment', async () => {
  await withHarness(async () => {
    const paid = { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'paid', capturedAmount: 2500 };
    setup([makeOrder({ status: 'accepted', payment: paid })], [pendingTransaction({ status: 'paid' })]);

    for (const gatewayStatus of ['failed', 'abandoned']) {
      paystackVerifyData = charge(gatewayStatus);
      const { body } = await refresh();
      assertEquals(body.data.paymentStatus, 'paid');
    }

    assertEquals(order().payment, paid);
    assertEquals(order().needsAttention, false);
    assertEquals(db.PaymentTransaction[0].status, 'paid');
    assertEquals(db.OperationalAlert.length, 0);
    assertEquals(db.queue_notifications.length, 0);
  });
});

Deno.test('refresh: a reversed charge on a paid order keeps it paid, flags it and alerts admins once', async () => {
  await withHarness(async () => {
    const paid = { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'paid', capturedAmount: 2500 };
    setup([makeOrder({ status: 'preparing', payment: paid })], [pendingTransaction({ status: 'paid' })]);
    paystackVerifyData = charge('reversed');

    const { body } = await refresh();

    assertEquals(body.data.paymentStatus, 'paid');
    assertEquals(order().status, 'preparing');
    assertEquals(order().payment.status, 'paid');
    assertEquals(order().needsAttention, true);
    assertEquals(typeof order().timeline.paymentReversedAt, 'string');
    assertEquals(db.PaymentTransaction[0].status, 'paid');
    assertEquals(db.OperationalAlert.map((alert) => alert.alertType), ['payment_reversed_on_paid_order']);
    assertEquals(db.OperationalAlert[0].severity, 'high');

    // The customer screen keeps refreshing: the flag is not re-raised and the
    // admins are not paged again.
    const flaggedAt = order().timeline.paymentReversedAt;
    await refresh();
    assertEquals(order().timeline.paymentReversedAt, flaggedAt);
    assertEquals(db.OperationalAlert.length, 1);
  });
});

Deno.test('refresh: an abandoned verify on an unpaid order records failed and tells the customer once', async () => {
  await withHarness(async () => {
    setup([makeOrder()]);
    paystackVerifyData = charge('abandoned');

    const first = await refresh();
    const second = await refresh();

    assertEquals(first.body.data.paymentStatus, 'failed');
    assertEquals(second.body.data.paymentStatus, 'failed');
    assertEquals(order().status, 'placed');
    assertEquals(order().payment.status, 'failed');
    assertEquals(db.PaymentTransaction[0].status, 'failed');
    assertEquals(notifications('customer', 'payment_failed').length, 1);
  });
});

Deno.test('refresh then a later success: a failed payment can still become paid (forwards, not backwards)', async () => {
  await withHarness(async () => {
    setup([makeOrder({ payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'failed' } })]);
    paystackVerifyData = charge('success');

    const { body } = await refresh();

    assertEquals(body.data.paymentStatus, 'paid');
    assertEquals(order().status, 'placed');
    assertEquals(order().payment.status, 'paid');
    assertEquals(events('payment_confirmed').length, 1);
    assertEquals(notifications('partner', 'payment_confirmed').length, 1);
    assertEquals(notifications('customer', 'payment_confirmed').length, 1);
  });
});

Deno.test('webhook then refresh on the same charge: one notification set and one payment_confirmed event', async () => {
  await withHarness(async () => {
    setup([makeOrder()]);
    paystackVerifyData = charge('success');

    await webhook();
    const { body } = await refresh();

    assertEquals(body.data.paymentStatus, 'paid');
    assertEquals(events('payment_confirmed').length, 1);
    assertEquals(notifications('partner', 'payment_confirmed').length, 1);
    assertEquals(notifications('customer', 'payment_confirmed').length, 1);
  });
});

Deno.test('webhook and refresh racing on the first payment: the compare-and-set lets exactly one notify', async () => {
  await withHarness(async () => {
    setup([makeOrder()]);
    paystackVerifyData = charge('success');

    // The webhook has read 'pending' and verified; just before its UPDATE is
    // evaluated, a customer refresh runs start to finish (it too read
    // 'pending', past every early return).
    let raced = false;
    beforeUpdate = async (table, payload) => {
      if (table !== 'CustomerOrder' || payload.payment?.status !== 'paid') return;
      raced = true;
      await refresh();
    };

    const result = await webhook();

    assertEquals(raced, true);
    assertEquals(result.paymentStatus, 'paid');
    assertEquals(order().status, 'placed');
    assertEquals(order().payment.status, 'paid');
    assertEquals(events('payment_confirmed').length, 1);
    assertEquals(notifications('partner', 'payment_confirmed').length, 1);
    assertEquals(notifications('customer', 'payment_confirmed').length, 1);
    assertEquals(db.PaymentTransaction[0].status, 'paid');
  });
});

Deno.test('refresh and webhook racing the other way round: still exactly one notification set', async () => {
  await withHarness(async () => {
    setup([makeOrder()]);
    paystackVerifyData = charge('success');

    beforeUpdate = async (table, payload) => {
      if (table !== 'CustomerOrder' || payload.payment?.status !== 'paid') return;
      await webhook();
    };

    const { body } = await refresh();

    assertEquals(body.data.paymentStatus, 'paid');
    assertEquals(events('payment_confirmed').length, 1);
    assertEquals(notifications('partner', 'payment_confirmed').length, 1);
    assertEquals(notifications('customer', 'payment_confirmed').length, 1);
  });
});

// ───────────────────────── Spec 6: unpaid expiry ─────────────────────────

const NOW = new Date('2026-11-12T12:00:00.000Z');
const minutesBeforeNow = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE).toISOString();

const unpaidOrder = (id: string, method: string, ageMinutes: number, paymentStatus = 'pending'): Row =>
  makeOrder({
    id,
    createdAt: minutesBeforeNow(ageMinutes),
    payment: {
      method,
      provider: 'paystack',
      reference: `REF-${id}`,
      status: paymentStatus,
    },
  });

const transactionFor = (id: string, status = 'pending'): Row =>
  pendingTransaction({ id: `REF-${id}`, reference: `REF-${id}`, orderId: id, status });

Deno.test('expiry: a bank transfer at 20 minutes is left alone, at 36 minutes it is cancelled', async () => {
  await withHarness(async () => {
    setup(
      [unpaidOrder('bank-20', 'bank_transfer', 20), unpaidOrder('bank-36', 'bank_transfer', 36)],
      [transactionFor('bank-20'), transactionFor('bank-36')]
    );

    const result = await sweepUnpaidOrders(NOW);

    assertEquals(result, { expired: 1, skipped: 0 });
    assertEquals(order('bank-20').status, 'placed');
    assertEquals(order('bank-20').payment.status, 'pending');
    assertEquals(order('bank-36').status, 'cancelled');
    assertEquals(order('bank-36').cancellation.reason, 'payment_timeout');
    assertEquals(events('payment_timeout').map((event) => [event.orderId, event.details.timeoutMinutes]), [['bank-36', 35]]);
  });
});

Deno.test('expiry: a card order at 16 minutes is cancelled and its ledger row follows it', async () => {
  await withHarness(async () => {
    setup([unpaidOrder('card-16', 'card', 16)], [transactionFor('card-16')]);

    const result = await sweepUnpaidOrders(NOW);

    assertEquals(result, { expired: 1, skipped: 0 });
    assertEquals(order('card-16').status, 'cancelled');
    assertEquals(order('card-16').payment.status, 'failed');
    assertEquals(order('card-16').payment.lastEvent, 'payment_timeout');
    assertEquals('refundAmount' in order('card-16').payment, false);
    const ledger = db.PaymentTransaction.find((row) => row.reference === 'REF-card-16');
    assertEquals(ledger?.status, 'failed');
    assertEquals(ledger?.lastError, 'payment_timeout');
    assertEquals(typeof ledger?.failedAt, 'string');
    assertEquals(events('payment_timeout').map((event) => event.details.timeoutMinutes), [15]);
    assertEquals(releaseCalls().length, 1);
  });
});

Deno.test('expiry: an order whose payment FAILED is cancelled by the sweep once its window is up, with no refund', async () => {
  await withHarness(async () => {
    setup(
      [
        unpaidOrder('failed-old', 'card', 20, 'failed'),
        unpaidOrder('failed-fresh', 'card', 5, 'failed'),
      ],
      [transactionFor('failed-old', 'failed'), transactionFor('failed-fresh', 'failed')]
    );

    const result = await sweepUnpaidOrders(NOW);

    assertEquals(result, { expired: 1, skipped: 0 });
    assertEquals(order('failed-old').status, 'cancelled');
    assertEquals(order('failed-old').cancellation.reason, 'payment_failed');
    assertEquals(order('failed-old').payment.status, 'failed');
    assertEquals('refundAmount' in order('failed-old').payment, false);
    assertEquals('refundedAt' in order('failed-old').payment, false);
    assertEquals(order('failed-fresh').status, 'placed');
    assertEquals(events('payment_timeout').map((event) => event.orderId), ['failed-old']);
  });
});

Deno.test('expiry: side effects happen once - a second sweep finds nothing to do', async () => {
  await withHarness(async () => {
    setup([unpaidOrder('card-30', 'card', 30)], [transactionFor('card-30')]);

    await sweepUnpaidOrders(NOW);
    const second = await sweepUnpaidOrders(NOW);

    assertEquals(second, { expired: 0, skipped: 0 });
    assertEquals(events('payment_timeout').length, 1);
    assertEquals(releaseCalls().length, 1);
  });
});

Deno.test('expiry racing a webhook that marks the order paid: the order stays paid', async () => {
  await withHarness(async () => {
    const racing = makeOrder({ createdAt: minutesBeforeNow(16) });
    setup([racing]);
    paystackVerifyData = charge('success');

    // The sweep has read 'placed' + 'pending'; the webhook commits 'paid' just
    // before the sweep's cancel is evaluated.
    let raced = false;
    beforeUpdate = async (table, payload) => {
      if (table !== 'CustomerOrder' || payload.status !== 'cancelled') return;
      raced = true;
      await webhook();
    };

    const result = await sweepUnpaidOrders(NOW);

    assertEquals(raced, true);
    assertEquals(result, { expired: 0, skipped: 1 });
    assertEquals(order().status, 'placed');
    assertEquals(order().payment.status, 'paid');
    assertEquals(order().cancellation, null);
    assertEquals(db.PaymentTransaction[0].status, 'paid');
    assertEquals(events('payment_timeout').length, 0);
    assertEquals(releaseCalls().length, 0);
    assertEquals(notifications('partner', 'payment_confirmed').length, 1);
  });
});

Deno.test('expiry: one order that throws does not stop the rest of the sweep', async () => {
  await withHarness(async () => {
    setup(
      [unpaidOrder('card-bad', 'card', 40), unpaidOrder('card-good', 'card', 30)],
      [transactionFor('card-bad'), transactionFor('card-good')]
    );

    beforeUpdate = (table, _payload, filterLabels) => {
      if (table === 'CustomerOrder' && filterLabels.includes('id=card-bad')) {
        throw new Error('simulated database failure');
      }
    };

    const result = await sweepUnpaidOrders(NOW);

    assertEquals(result, { expired: 1, skipped: 1 });
    assertEquals(order('card-bad').status, 'placed');
    assertEquals(order('card-good').status, 'cancelled');
  });
});

Deno.test('lazy expiry on read uses the same windows: a 20-minute bank transfer stays, a 16-minute card goes', async () => {
  await withHarness(async () => {
    const bank = makeOrder({
      id: 'lazy-bank',
      createdAt: new Date(Date.now() - 20 * MINUTE).toISOString(),
      payment: { method: 'bank_transfer', provider: 'paystack', reference: 'REF-lazy-bank', status: 'pending' },
    });
    const card = makeOrder({
      id: 'lazy-card',
      createdAt: new Date(Date.now() - 16 * MINUTE).toISOString(),
      payment: { method: 'card', provider: 'paystack', reference: 'REF-lazy-card', status: 'pending' },
    });
    setup([bank, card], [transactionFor('lazy-bank'), transactionFor('lazy-card')]);

    const bankAfter = await maybeExpireUnpaidOrder(structuredClone(bank) as never);
    const cardAfter = await maybeExpireUnpaidOrder(structuredClone(card) as never);

    assertEquals(bankAfter.status, 'placed');
    assertEquals(cardAfter.status, 'cancelled');
    assertEquals(order('lazy-card').status, 'cancelled');
    assertEquals(db.PaymentTransaction.find((row) => row.reference === 'REF-lazy-card')?.status, 'failed');
  });
});

Deno.test('lazy expiry that loses the race to a payment returns the fresh, paid order', async () => {
  await withHarness(async () => {
    const stale = makeOrder({ createdAt: new Date(Date.now() - 16 * MINUTE).toISOString() });
    setup([stale]);
    paystackVerifyData = charge('success');

    beforeUpdate = async (table, payload) => {
      if (table !== 'CustomerOrder' || payload.status !== 'cancelled') return;
      await webhook();
    };

    const after = await maybeExpireUnpaidOrder(structuredClone(stale) as never);

    assertEquals(after.status, 'placed');
    assertEquals(after.payment?.status, 'paid');
    assertEquals(order().status, 'placed');
  });
});
