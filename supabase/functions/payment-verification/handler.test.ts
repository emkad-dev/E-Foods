// End-to-end tests for handlePaymentVerification against an in-memory fake of
// the Supabase tables it touches. Paystack is stubbed through globalThis.fetch.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');

import { assertEquals, assertRejects } from 'jsr:@std/assert';

const { serviceClient } = await import('../_shared/client.ts');
const { handlePaymentVerification } = await import('./handler.ts');

type Row = Record<string, any>;
type Db = Record<string, Row[]>;

let db: Db = {};
// Every write the handler issues, in order, for assertions on what was NOT written.
let writes: Array<{ table: string; op: string; payload: any; filters: string[] }> = [];
let paystackVerifyData: Row | null = null;

const originalFrom = serviceClient.from.bind(serviceClient);
const originalFetch = globalThis.fetch;
const originalConsole = { error: console.error, warn: console.warn, log: console.log };

const makeBuilder = (table: string) => {
  const filters: Array<(row: Row) => boolean> = [];
  const filterLabels: string[] = [];
  let op: 'select' | 'update' | 'upsert' | 'insert' | 'delete' = 'select';
  let payload: any = null;
  let upsertConflict: string | null = null;

  const execute = (mode: 'single' | 'maybeSingle' | 'many') => {
    const rows = (db[table] ??= []);
    const matches = rows.filter((row) => filters.every((f) => f(row)));

    if (op === 'select') {
      const data = matches.map((row) => structuredClone(row));
      if (mode === 'many') return { data, error: null };
      if (mode === 'single' && data.length !== 1) return { data: null, error: { message: 'single row expected' } };
      return { data: data[0] ?? null, error: null };
    }

    writes.push({ table, op, payload: structuredClone(payload), filters: filterLabels.slice() });

    if (op === 'update') {
      for (const row of matches) Object.assign(row, structuredClone(payload));
      const data = matches.map((row) => structuredClone(row));
      return { data: mode === 'many' ? data : (data[0] ?? null), error: null };
    }
    if (op === 'insert') {
      for (const item of Array.isArray(payload) ? payload : [payload]) rows.push(structuredClone(item));
      return { data: null, error: null };
    }
    if (op === 'upsert') {
      const key = upsertConflict ?? 'id';
      const existing = rows.find((row) => row[key] === payload[key]);
      if (existing) Object.assign(existing, structuredClone(payload));
      else rows.push(structuredClone(payload));
      return { data: null, error: null };
    }
    // delete
    db[table] = rows.filter((row) => !matches.includes(row));
    return { data: null, error: null };
  };

  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      filterLabels.push(`${column}=${String(value)}`);
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      filterLabels.push(`${column} in (${values.join(',')})`);
      return builder;
    },
    order: () => builder,
    returns: () => builder,
    limit: () => builder,
    gte: () => builder,
    lte: () => builder,
    update: (value: unknown) => {
      op = 'update';
      payload = value;
      return builder;
    },
    insert: (value: unknown) => {
      op = 'insert';
      payload = value;
      return builder;
    },
    upsert: (value: unknown, options?: { onConflict?: string }) => {
      op = 'upsert';
      payload = value;
      upsertConflict = options?.onConflict ?? null;
      return builder;
    },
    delete: () => {
      op = 'delete';
      return builder;
    },
    single: () => Promise.resolve(execute('single')),
    maybeSingle: () => Promise.resolve(execute('maybeSingle')),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute('many')).then(resolve, reject),
  };
  return builder;
};

const REFERENCE = 'FEASTY-CRD-TEST-1';

const makeOrder = (overrides: Row = {}): Row => ({
  id: 'order-1',
  customerId: 'cust-1',
  orderGroupId: null,
  restaurantId: 'rest-1',
  status: 'placed',
  needsAttention: false,
  payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'pending', settlementMode: 'manual' },
  pricing: { total: 2500 },
  timeline: { placedAt: '2026-10-19T10:00:00.000Z' },
  ...overrides,
});

const setup = (orders: Row[], group: Row | null = null) => {
  db = {
    CustomerOrder: orders.map((o) => structuredClone(o)),
    OrderGroup: group ? [structuredClone(group)] : [],
    PaymentTransaction: [],
    IdempotencyRecord: [],
    OperationalAlert: [],
    DeliveryEvent: [],
    UserRole: [{ userId: 'partner-user-1', role: 'restaurant', restaurantId: 'rest-1' }],
    queue_notifications: [],
    UserAccount: [],
  };
  writes = [];
};

const orderById = (id: string) => {
  const row = db.CustomerOrder.find((o) => o.id === id);
  if (!row) throw new Error(`order ${id} missing from fake db`);
  return row;
};

const withHarness = async (work: () => Promise<void>) => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => makeBuilder(table);
  globalThis.fetch = ((input: unknown) => {
    const url = String(input);
    if (url.startsWith('https://api.paystack.co/transaction/verify/')) {
      return Promise.resolve(
        new Response(JSON.stringify({ status: true, data: paystackVerifyData }), {
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
  try {
    await work();
  } finally {
    // deno-lint-ignore no-explicit-any
    (serviceClient as any).from = originalFrom;
    globalThis.fetch = originalFetch;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.log = originalConsole.log;
  }
};

const successfulCharge = (amountKobo: number) => ({
  id: 987654,
  amount: amountKobo,
  reference: REFERENCE,
  status: 'success',
  gateway_response: 'Successful',
  channel: 'card',
});

const verify = (orderId: string) => handlePaymentVerification({ orderId, paymentReference: REFERENCE } as never);

// ───────────────────────── single-store (the working path) ─────────────────────────

Deno.test('single-store payment: order is placed + paid, restaurant notified, payment transaction recorded', async () => {
  await withHarness(async () => {
    setup([makeOrder()]);
    paystackVerifyData = successfulCharge(250000);

    const result = await verify('order-1');

    assertEquals(result, { success: true, orderId: 'order-1', paymentStatus: 'paid' });
    const order = orderById('order-1');
    assertEquals(order.status, 'placed');
    assertEquals(order.payment.status, 'paid');
    assertEquals(order.payment.capturedAmount, 2500);
    assertEquals(order.payment.reference, REFERENCE);
    assertEquals(typeof order.timeline.paidAt, 'string');
    assertEquals(typeof order.timeline.confirmedAt, 'string');
    assertEquals(order.timeline.placedAt, '2026-10-19T10:00:00.000Z');
    assertEquals(order.needsAttention, false);
    assertEquals(db.PaymentTransaction.length, 1);
    assertEquals(db.PaymentTransaction[0].status, 'paid');
    assertEquals(db.PaymentTransaction[0].amount, 2500);
    assertEquals(db.queue_notifications.length, 1);
    assertEquals(db.OperationalAlert.length, 0);
    assertEquals(db.DeliveryEvent.length, 0);
    // Single-store orders carry no group, so no OrderGroup lookup for amount validation.
    assertEquals(writes.filter((w) => w.table === 'CustomerOrder').length, 1);
    // The write is exactly the pre-existing shape: these four columns, nothing else
    // (in particular no needsAttention and no extra payment/timeline keys).
    const orderWrite = writes.find((w) => w.table === 'CustomerOrder')!;
    assertEquals(Object.keys(orderWrite.payload).sort(), ['payment', 'status', 'timeline', 'updatedAt']);
    assertEquals(
      Object.keys(orderWrite.payload.payment).sort(),
      [
        'capturedAmount',
        'lastEvent',
        'method',
        'paidAt',
        'paystackResponse',
        'provider',
        'reference',
        'settlementMode',
        'status',
        'verifiedAt',
      ]
    );
    assertEquals(Object.keys(orderWrite.payload.timeline).sort(), ['confirmedAt', 'paidAt', 'placedAt']);
  });
});

Deno.test('single-store payment: a wrong gateway amount is still rejected and nothing is written', async () => {
  await withHarness(async () => {
    setup([makeOrder()]);
    paystackVerifyData = successfulCharge(250001);

    await assertRejects(() => verify('order-1'), Error, 'Amount mismatch: expected 250000, got 250001');
    assertEquals(writes.length, 0);
    assertEquals(orderById('order-1').payment.status, 'pending');
  });
});

// ───────────────────────── multi-store group amount ─────────────────────────

const groupOrders = () => [
  makeOrder({ id: 'order-1', orderGroupId: 'order-1', restaurantId: 'rest-1', pricing: { total: 4300 } }),
  makeOrder({ id: 'order-2', orderGroupId: 'order-1', restaurantId: 'rest-2', pricing: { total: 8500 } }),
];
const groupRow = {
  id: 'order-1',
  orderCount: 2,
  orderIds: ['order-1', 'order-2'],
  pricing: { total: 12800 },
};

Deno.test('multi-store payment: the group total charged by Paystack is accepted and every order is paid', async () => {
  await withHarness(async () => {
    setup(groupOrders(), groupRow);
    paystackVerifyData = successfulCharge(1280000);

    const result = await verify('order-1');

    assertEquals(result, { success: true, orderId: 'order-1', paymentStatus: 'paid' });
    for (const id of ['order-1', 'order-2']) {
      const order = orderById(id);
      assertEquals(order.status, 'placed');
      assertEquals(order.payment.status, 'paid');
    }
  });
});

Deno.test('multi-store payment: charging only the primary order share is rejected', async () => {
  await withHarness(async () => {
    setup(groupOrders(), groupRow);
    paystackVerifyData = successfulCharge(430000);

    await assertRejects(() => verify('order-1'), Error, 'Amount mismatch: expected 1280000, got 430000');
    assertEquals(writes.length, 0);
  });
});

// ───────────────────────── late / non-awaiting orders must not be overwritten ─────────────────────────

Deno.test('scheduled order that is paid stays scheduled (not released into the kitchen early)', async () => {
  await withHarness(async () => {
    setup([
      makeOrder({
        status: 'scheduled',
        scheduledFor: '2026-10-20T12:00:00.000Z',
        timeline: { scheduledAt: '2026-10-19T10:00:00.000Z', scheduledFor: '2026-10-20T12:00:00.000Z' },
      }),
    ]);
    paystackVerifyData = successfulCharge(250000);

    const result = await verify('order-1');

    assertEquals(result, { success: true, orderId: 'order-1', paymentStatus: 'paid' });
    const order = orderById('order-1');
    assertEquals(order.status, 'scheduled');
    assertEquals(order.payment.status, 'paid');
    assertEquals(order.payment.capturedAmount, 2500);
    assertEquals(order.timeline.scheduledFor, '2026-10-20T12:00:00.000Z');
    assertEquals('placedAt' in order.timeline, false);
    assertEquals(typeof order.timeline.paidAt, 'string');
    assertEquals(order.needsAttention, false);
    assertEquals(db.OperationalAlert.length, 0);
    assertEquals(db.PaymentTransaction[0].status, 'paid');
  });
});

Deno.test('cancelled order that receives a payment: recorded as paid, NOT revived, NOT refunded, flagged for attention', async () => {
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
          failedAt: '2026-10-19T10:15:00.000Z',
        },
        cancellation: { actor: 'system', reason: 'payment_timeout' },
        timeline: { placedAt: '2026-10-19T10:00:00.000Z', cancelledAt: '2026-10-19T10:15:00.000Z' },
      }),
    ]);
    paystackVerifyData = successfulCharge(250000);

    const result = await verify('order-1');

    assertEquals(result, { success: true, orderId: 'order-1', paymentStatus: 'paid' });
    const order = orderById('order-1');
    assertEquals(order.status, 'cancelled'); // not marked placed
    assertEquals(order.payment.status, 'paid'); // money recorded
    assertEquals(order.payment.capturedAmount, 2500);
    assertEquals('refundAmount' in order.payment, false); // no auto-refund
    assertEquals('refundedAt' in order.payment, false);
    assertEquals(order.needsAttention, true);
    assertEquals(order.cancellation, { actor: 'system', reason: 'payment_timeout' });
    assertEquals(order.timeline.cancelledAt, '2026-10-19T10:15:00.000Z'); // history preserved
    assertEquals('confirmedAt' in order.timeline, false);
    assertEquals(typeof order.timeline.paidAt, 'string');

    assertEquals(db.DeliveryEvent.length, 1);
    assertEquals(db.DeliveryEvent[0].eventType, 'payment_received_on_closed_order');
    assertEquals(db.DeliveryEvent[0].orderId, 'order-1');
    assertEquals(db.OperationalAlert.length, 1);
    assertEquals(db.OperationalAlert[0].alertType, 'payment_on_closed_order');
    assertEquals(db.OperationalAlert[0].severity, 'high');
    assertEquals(db.OperationalAlert[0].dedupeKey, 'ops:payment_on_closed_order:order-1');

    // The restaurant must not be told a cancelled order is "paid and ready for confirmation".
    assertEquals(db.queue_notifications.length, 0);
    // The money is still recorded.
    assertEquals(db.PaymentTransaction.length, 1);
    assertEquals(db.PaymentTransaction[0].status, 'paid');
  });
});

Deno.test('order already in the kitchen (accepted) is not regressed to placed by a payment confirmation', async () => {
  await withHarness(async () => {
    setup([makeOrder({ status: 'accepted' })]);
    paystackVerifyData = successfulCharge(250000);

    await verify('order-1');

    const order = orderById('order-1');
    assertEquals(order.status, 'accepted');
    assertEquals(order.payment.status, 'paid');
    assertEquals(order.needsAttention, false);
  });
});

Deno.test('multi-order group: awaiting order is placed, cancelled order is only flagged, amounts and settlement stay per-order', async () => {
  await withHarness(async () => {
    const settlement1 = { netSettlement: 3000 };
    const settlement2 = { netSettlement: 7000 };
    setup(
      [
        makeOrder({
          id: 'order-1',
          orderGroupId: 'order-1',
          pricing: { total: 4300 },
          payment: { method: 'card', reference: REFERENCE, status: 'pending', settlement: settlement1 },
        }),
        makeOrder({
          id: 'order-2',
          orderGroupId: 'order-1',
          restaurantId: 'rest-2',
          status: 'cancelled',
          pricing: { total: 8500 },
          payment: { method: 'card', reference: REFERENCE, status: 'failed', settlement: settlement2 },
          timeline: { placedAt: '2026-10-19T10:00:00.000Z', cancelledAt: '2026-10-19T10:15:00.000Z' },
        }),
      ],
      groupRow
    );
    paystackVerifyData = successfulCharge(1280000);

    const result = await verify('order-1');

    assertEquals(result, { success: true, orderId: 'order-1', paymentStatus: 'paid' });
    const first = orderById('order-1');
    const second = orderById('order-2');

    assertEquals(first.status, 'placed');
    assertEquals(first.payment.status, 'paid');
    assertEquals(first.payment.capturedAmount, 4300);
    assertEquals(first.payment.settlement, settlement1);
    assertEquals(first.needsAttention, false);

    assertEquals(second.status, 'cancelled');
    assertEquals(second.payment.status, 'paid');
    assertEquals(second.payment.capturedAmount, 8500);
    assertEquals(second.payment.settlement, settlement2);
    assertEquals(second.needsAttention, true);
    assertEquals(second.timeline.cancelledAt, '2026-10-19T10:15:00.000Z');

    assertEquals(db.DeliveryEvent.map((e) => e.orderId), ['order-2']);
    assertEquals(db.OperationalAlert.map((a) => a.subjectId), ['order-2']);
    // One Paystack charge, one transaction row, for the whole group total.
    assertEquals(db.PaymentTransaction.length, 1);
    assertEquals(db.PaymentTransaction[0].amount, 12800);
    // The primary order was awaiting, so the normal restaurant notification still goes out.
    assertEquals(db.queue_notifications.length, 1);
  });
});

Deno.test('multi-order group: all orders awaiting are all placed and paid', async () => {
  await withHarness(async () => {
    setup(groupOrders(), groupRow);
    paystackVerifyData = successfulCharge(1280000);

    await verify('order-1');

    assertEquals(orderById('order-1').status, 'placed');
    assertEquals(orderById('order-2').status, 'placed');
    assertEquals(orderById('order-1').payment.capturedAmount, 4300);
    assertEquals(orderById('order-2').payment.capturedAmount, 8500);
    assertEquals(db.OperationalAlert.length, 0);
    assertEquals(db.DeliveryEvent.length, 0);
  });
});

Deno.test('an order cancelled between the initial read and the write is not overwritten (compare-and-set)', async () => {
  await withHarness(async () => {
    setup([makeOrder()]);
    // The cancel lands while Paystack verification is in flight: the handler
    // already holds a snapshot that says 'placed'.
    const stubbedFetch = globalThis.fetch;
    globalThis.fetch = ((input: unknown, init?: unknown) => {
      if (String(input).startsWith('https://api.paystack.co/transaction/verify/')) {
        orderById('order-1').status = 'cancelled';
      }
      return stubbedFetch(input as never, init as never);
    }) as typeof fetch;
    paystackVerifyData = successfulCharge(250000);

    await verify('order-1');

    const order = orderById('order-1');
    assertEquals(order.status, 'cancelled');
    assertEquals(order.payment.status, 'paid');
    assertEquals(order.needsAttention, true);
    assertEquals(db.OperationalAlert.length, 1);
  });
});
