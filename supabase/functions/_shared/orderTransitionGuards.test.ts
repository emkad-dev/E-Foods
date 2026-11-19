// Transition guards and paid rejection (order-flow fixes, Spec 8 and 9). Drives
// the REAL handlers out of the REAL domain maps - partnerUpdateOrderStatus,
// dispatchUpdateOrderStatus and cancelCustomerOrder - against one in-memory
// fake of the tables they touch, and asserts the STORED rows: order and payment
// status, the recorded refund, needsAttention, OperationalAlert rows, the promo
// release and the admin alert, and the delivery-code attempt counter.
//
// Races are staged with a hook that runs just before a matching UPDATE is
// evaluated - the moment a concurrent writer's commit would land between a
// handler's read and its compare-and-set. The fake applies every filter of the
// UPDATE together, after the hook, the way Postgres re-evaluates the WHERE once
// it holds the row lock.
//
// Runs in package.json's --no-check `deno test` group: the domain modules
// import _shared/client.ts, which throws at module scope without these env vars.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

import { assertEquals } from 'jsr:@std/assert';

const { serviceClient } = await import('./client.ts');
const { partnerDomain } = await import('./domains/partner.ts');
const { dispatchDomain } = await import('./domains/dispatch.ts');
const { ordersDomain } = await import('./domains/orders.ts');

const partnerUpdateOrderStatus = partnerDomain.handlers.partnerUpdateOrderStatus;
const dispatchUpdateOrderStatus = dispatchDomain.handlers.dispatchUpdateOrderStatus;
const cancelCustomerOrder = ordersDomain.handlers.cancelCustomerOrder;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type UpdateHook = { when: (table: string, payload: Row) => boolean; run: () => void };

let db: Record<string, Row[]> = {};
let rpcCalls: Array<{ fn: string; params: Row }> = [];
let updateHook: UpdateHook | null = null;

const ORDER_ID = 'order-guard-1';
const REFERENCE = 'FEASTY-CRD-GUARD-1';
const PARTNER_UID = 'partner-user-1';
const RIDER_UID = 'rider-guard-1';
const CUSTOMER_UID = 'cust-guard-1';

// A PostgREST column, including JSON paths like 'payment->>status' or
// 'payment->refundExecution->>status': '->' keeps JSON, a final '->>' gives
// text (null when absent).
const readColumn = (row: Row, column: string): unknown => {
  const textMode = column.includes('->>');
  const [base, ...path] = column.split(/->>|->/);
  let value: unknown = row[base];
  for (const key of path) {
    value = value && typeof value === 'object' ? (value as Row)[key] : undefined;
  }
  if (path.length === 0) return value;
  if (value === undefined || value === null) return null;
  return textMode ? (typeof value === 'object' ? JSON.stringify(value) : String(value)) : value;
};

const makeBuilder = (table: string) => {
  const filters: Array<(row: Row) => boolean> = [];
  let op: 'select' | 'update' | 'upsert' | 'insert' | 'delete' = 'select';
  let payload: Row | Row[] | null = null;
  let upsertConflict: string | null = null;
  let limitCount: number | null = null;

  const execute = (mode: 'single' | 'maybeSingle' | 'many') => {
    if (op === 'update' && updateHook && updateHook.when(table, payload as Row)) {
      const hook = updateHook;
      updateHook = null;
      hook.run();
    }

    const rows = (db[table] ??= []);
    const matches = rows.filter((row) => filters.every((filter) => filter(row)));

    if (op === 'select') {
      let result = matches;
      if (limitCount !== null) result = result.slice(0, limitCount);
      const data = result.map((row) => structuredClone(row));
      if (mode === 'many') return Promise.resolve({ data, error: null });
      return Promise.resolve({ data: data[0] ?? null, error: null });
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
    not: () => builder,
    or: () => builder,
    order: () => builder,
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

const CAPTURED = 4300;

const makeOrder = (overrides: Row = {}): Row => ({
  id: ORDER_ID,
  customerId: CUSTOMER_UID,
  restaurantId: 'rest-1',
  restaurantName: 'Test Kitchen',
  orderGroupId: null,
  status: 'accepted',
  fulfillmentType: 'delivery',
  needsAttention: false,
  customerIssueReportedAt: null,
  payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'paid', capturedAmount: CAPTURED },
  pricing: { total: CAPTURED },
  timeline: { placedAt: new Date().toISOString() },
  cancellation: null,
  deliveryCode: '1234',
  deliveryCodeAttempts: 0,
  deliveryCodeVerifiedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const setup = (order: Row, assignment: Row | null = null) => {
  db = {
    CustomerOrder: [structuredClone(order)],
    OrderItem: [],
    DeliveryAssignment: assignment ? [structuredClone(assignment)] : [],
    DeliveryEvent: [],
    PaymentTransaction: [{ id: REFERENCE, reference: REFERENCE, orderId: ORDER_ID, status: 'paid', amount: CAPTURED }],
    OperationalAlert: [],
    RestaurantRecord: [{ id: 'rest-1', ownerId: PARTNER_UID, name: 'Test Kitchen', updatedAt: new Date().toISOString() }],
    RestaurantApproval: [],
    UserRole: [{ userId: 'admin-1', role: 'admin', restaurantId: null }],
    UserAccount: [],
  };
  rpcCalls = [];
  updateHook = null;
};

const riderAssignment = (): Row => ({
  orderId: ORDER_ID,
  courierId: RIDER_UID,
  courierName: 'Ada Rider',
  dispatchId: null,
  dispatchOwnerId: RIDER_UID,
  assignedAt: new Date().toISOString(),
  loadReleasedAt: null,
});

const withHarness = async (work: () => Promise<void>) => {
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).from = (table: string) => makeBuilder(table);
  // deno-lint-ignore no-explicit-any
  (serviceClient as any).rpc = (fn: string, params: Row) => {
    rpcCalls.push({ fn, params });
    return Promise.resolve({ data: [], error: null });
  };
  globalThis.fetch = (() => Promise.resolve(new Response('{}', { status: 200 }))) as typeof fetch;
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

const contextFor = (uid: string, role: string) => ({
  email: `${uid}@example.test`,
  role,
  token: 'fake-token',
  uid,
  userProfile: { uid, email: `${uid}@example.test`, role, accountDisabled: false },
});

const call = (handler: unknown, context: Row, data: Row) =>
  // deno-lint-ignore no-explicit-any
  (handler as any)({ context, data, request: new Request('https://example.test/rpc', { method: 'POST' }) });

const partnerAction = (action: string) => call(partnerUpdateOrderStatus, contextFor(PARTNER_UID, 'restaurant'), { action, orderId: ORDER_ID });
const dispatchAction = (action: string, extra: Row = {}) =>
  call(dispatchUpdateOrderStatus, contextFor(RIDER_UID, 'dispatch'), { action, orderId: ORDER_ID, ...extra });
const customerCancel = () => call(cancelCustomerOrder, contextFor(CUSTOMER_UID, 'customer'), { orderId: ORDER_ID });

const expectFailure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as { status?: number; message?: string };
  }
  throw new Error('expected the handler to fail, but it succeeded');
};

const order = () => db.CustomerOrder[0];
const events = (type: string) => db.DeliveryEvent.filter((event) => event.eventType === type);
const promoReleases = () => rpcCalls.filter((c) => c.fn === 'ebuy_release_promo_redemption' && c.params.p_order_id === ORDER_ID);
const adminAlertEmails = () =>
  rpcCalls.filter((c) => c.fn === 'auth_rl_hit' && c.params.p_key === `admin-alert-email:manual_refund_required:${ORDER_ID}`);
const refundAlerts = () => db.OperationalAlert.filter((alert) => alert.alertType === 'manual_refund_required');

// ───────────────────────── Spec 8: paid rejection ─────────────────────────

Deno.test('partner reject of a PAID order records the full refund, flags attention, frees the promo and alerts admins', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'accepted' }));
    const response = await partnerAction('reject');
    assertEquals(response.status, 200);

    assertEquals(order().status, 'rejected');
    assertEquals(order().payment.status, 'refunded', 'refund recorded the way cancellation records it');
    assertEquals(order().payment.refundAmount, CAPTURED, 'full refund (rate 1)');
    assertEquals(typeof order().payment.refundedAt, 'string');
    assertEquals(order().payment.lastEvent, 'restaurant_rejected_full_refund');
    assertEquals(order().payment.reference, REFERENCE, 'the rest of the payment is kept');
    assertEquals(order().needsAttention, true, 'a human must return the money');

    assertEquals(promoReleases().length, 1, 'promo slot released through the shared path');
    assertEquals(refundAlerts().length, 1, 'one OperationalAlert for the admin console');
    assertEquals(refundAlerts()[0].severity, 'high');
    assertEquals(refundAlerts()[0].subjectId, ORDER_ID);
    assertEquals(String(refundAlerts()[0].details).includes('A refund of'), true, 'alert names the recorded refund');
    assertEquals(adminAlertEmails().length, 1, 'admins notified (push + email)');

    assertEquals(db.PaymentTransaction[0].status, 'paid', 'ledger untouched, as cancellation leaves it');
    assertEquals(events('partner_reject').length, 1);
  });
});

Deno.test('partner reject of a paid order that was already flagged: the terminal attention clear does not undo the flag', async () => {
  // needsAttention true + a terminal status write is exactly what Task 3's clear
  // targets. The refund write raises the flag itself, so the clear must skip it.
  await withHarness(async () => {
    setup(makeOrder({ status: 'placed', needsAttention: true }));
    await partnerAction('reject');
    assertEquals(order().status, 'rejected');
    assertEquals(order().needsAttention, true);
    assertEquals(order().payment.status, 'refunded');
  });
});

Deno.test('partner reject of an unpaid (cash) order is unchanged: no refund, no flag, no promo release, no alert', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'placed', payment: { method: 'cash', status: 'pending' } }));
    const response = await partnerAction('reject');
    assertEquals(response.status, 200);
    assertEquals(order().status, 'rejected');
    assertEquals(order().payment, { method: 'cash', status: 'pending' });
    assertEquals(order().needsAttention, false);
    assertEquals(promoReleases().length, 0);
    assertEquals(refundAlerts().length, 0);
    assertEquals(adminAlertEmails().length, 0);
  });
});

Deno.test('a paid order whose refund could not be recorded is still flagged, and the alert does not claim a refund', async () => {
  // buildRefundUpdate records nothing for a non-prepaid method. The order still
  // needs a human, but the alert must say the payment has to be checked by hand.
  await withHarness(async () => {
    setup(makeOrder({ status: 'accepted', payment: { method: 'cash', status: 'paid' } }));
    const response = await partnerAction('reject');
    assertEquals(response.status, 200);
    assertEquals(order().status, 'rejected');
    assertEquals(order().payment.status, 'paid', 'nothing recorded');
    assertEquals(order().needsAttention, true);
    assertEquals(refundAlerts().length, 1);
    const details = String(refundAlerts()[0].details);
    assertEquals(details.includes('No refund could be recorded automatically'), true);
    assertEquals(details.includes('is recorded'), false);
  });
});

Deno.test('partner reject losing a race to a concurrent close changes nothing and alerts nobody', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'accepted' }));
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'rejected',
      run: () => {
        order().status = 'cancelled';
      },
    };
    const error = await expectFailure(() => partnerAction('reject'));
    assertEquals(error.status, 409);
    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'paid', 'no refund written by the loser');
    assertEquals(promoReleases().length, 0);
    assertEquals(refundAlerts().length, 0);
  });
});

Deno.test('dispatch failed_delivery on a PAID order records the full refund, flags attention, frees the promo and alerts admins', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'on_the_way', pricing: { total: CAPTURED, deliveryProvider: 'platform' } }), riderAssignment());
    const response = await dispatchAction('failed_delivery');
    assertEquals(response.status, 200);

    assertEquals(order().status, 'failed_delivery');
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().payment.refundAmount, CAPTURED);
    assertEquals(order().payment.lastEvent, 'failed_delivery_full_refund');
    assertEquals(order().needsAttention, true);
    assertEquals(promoReleases().length, 1);
    assertEquals(refundAlerts().length, 1);
    assertEquals(adminAlertEmails().length, 1);
    // Riders and the rider-load release are unchanged.
    assertEquals(rpcCalls.filter((c) => c.fn === 'ebuy_release_dispatch_assignment_load').length, 1);
  });
});

Deno.test('dispatch failed_delivery losing a race to a concurrent close changes nothing and alerts nobody', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'on_the_way', pricing: { total: CAPTURED, deliveryProvider: 'platform' } }), riderAssignment());
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'failed_delivery',
      run: () => {
        order().status = 'delivered';
      },
    };
    const error = await expectFailure(() => dispatchAction('failed_delivery'));
    assertEquals(error.status, 409);
    assertEquals(order().status, 'delivered');
    assertEquals(order().payment.status, 'paid', 'no refund written by the loser');
    assertEquals(order().needsAttention, false);
    assertEquals(promoReleases().length, 0);
    assertEquals(refundAlerts().length, 0);
    assertEquals(adminAlertEmails().length, 0);
  });
});

// ───────────────────────── Spec 9: partner delivered guard ─────────────────────────

Deno.test('partner delivered is refused for a FEASTY-rider (platform) delivery', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({ status: 'ready_for_pickup', pricing: { total: CAPTURED, deliveryProvider: 'platform' } }),
      riderAssignment()
    );
    const error = await expectFailure(() => partnerAction('delivered'));
    assertEquals(error.status, 412);
    assertEquals(
      error.message,
      'A FEASTY rider is delivering this order. It is completed when the rider hands it over to the customer.'
    );
    assertEquals(order().status, 'ready_for_pickup');
    assertEquals(order().deliveryCodeVerifiedAt, null);
  });
});

Deno.test('partner delivered is allowed for a pickup order', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'ready_for_pickup', fulfillmentType: 'pickup' }));
    const response = await partnerAction('delivered');
    assertEquals(response.status, 200);
    assertEquals(order().status, 'delivered');
  });
});

Deno.test('partner delivered is allowed for a restaurant-run delivery (stamped or legacy unstamped)', async () => {
  for (const pricing of [{ total: CAPTURED, deliveryProvider: 'restaurant' }, { total: CAPTURED }]) {
    await withHarness(async () => {
      // A restaurant-pool rider may hold the order; it is still the restaurant's delivery.
      setup(makeOrder({ status: 'ready_for_pickup', pricing }), riderAssignment());
      const response = await partnerAction('delivered');
      assertEquals(response.status, 200);
      assertEquals(order().status, 'delivered');
    });
  }
});

// ───────────────────────── Spec 9: conditional customer cancel ─────────────────────────

Deno.test('customer cancel losing a race to preparing changes nothing', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'accepted' }));
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'cancelled',
      run: () => {
        order().status = 'preparing';
      },
    };
    const error = await expectFailure(() => customerCancel());
    assertEquals(error.status, 409);
    assertEquals(error.message, 'This order has already moved on and can no longer be cancelled.');
    assertEquals(order().status, 'preparing');
    assertEquals(order().payment.status, 'paid', 'no refund recorded');
    assertEquals(order().payment.refundAmount, undefined);
    assertEquals(order().cancellation, null);
    assertEquals(promoReleases().length, 0, 'promo slot still held');
    assertEquals(events('order_cancelled').length, 0);
  });
});

Deno.test('customer cancel losing a race to accepted (still cancellable) asks for a reload, and changes nothing', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'placed' }));
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'cancelled',
      run: () => {
        order().status = 'accepted';
      },
    };
    const error = await expectFailure(() => customerCancel());
    assertEquals(error.status, 409);
    assertEquals(error.message, 'This order changed while you were cancelling it. Reload the order and try again.');
    assertEquals(order().status, 'accepted');
    assertEquals(order().payment.status, 'paid');
    assertEquals(promoReleases().length, 0);
  });
});

Deno.test('customer cancel racing a payment confirmation does not overwrite the payment, and a retry refunds it', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        status: 'placed',
        payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'pending' },
      })
    );
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'cancelled',
      run: () => {
        order().payment = { ...order().payment, status: 'paid', capturedAmount: CAPTURED };
      },
    };
    const error = await expectFailure(() => customerCancel());
    assertEquals(error.status, 409);
    assertEquals(error.message, 'This order changed while you were cancelling it. Reload the order and try again.');
    assertEquals(order().status, 'placed');
    assertEquals(order().payment.status, 'paid', 'the confirmed payment survives');

    const retry = await customerCancel();
    assertEquals(retry.status, 200);
    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().payment.refundAmount, CAPTURED);
  });
});

Deno.test('customer cancel with no race still cancels and refunds as before', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'accepted' }));
    const response = await customerCancel();
    assertEquals(response.status, 200);
    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().payment.lastEvent, 'customer_cancelled_full_refund');
    assertEquals(promoReleases().length, 1);
    assertEquals(events('order_cancelled').length, 1);
  });
});

// ───────────────────────── Customer cancel of a paid order needs a human ─────────────────────────

Deno.test('customer cancel of a PAID order flags attention and alerts admins once', async () => {
  // The refund is recorded only - no money moves - so somebody must pay it back.
  await withHarness(async () => {
    setup(makeOrder({ status: 'placed', needsAttention: true }));
    const response = await customerCancel();
    assertEquals(response.status, 200);
    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().payment.refundAmount, CAPTURED);
    assertEquals(order().needsAttention, true, 'flag kept through the terminal clear');
    assertEquals(refundAlerts().length, 1);
    assertEquals(String(refundAlerts()[0].details).includes('was cancelled by the customer'), true);
    assertEquals(String(refundAlerts()[0].details).includes('A refund of'), true);
    assertEquals(adminAlertEmails().length, 1);
    assertEquals(promoReleases().length, 1, 'one promo release, not two');
  });
});

Deno.test('customer cancel of an unpaid order raises no flag and no alert', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        status: 'placed',
        payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'pending' },
      })
    );
    db.PaymentTransaction[0].status = 'pending';
    const response = await customerCancel();
    assertEquals(response.status, 200);
    assertEquals(order().status, 'cancelled');
    // Nothing was captured, so nothing is refunded: the payment closes as
    // failed (never 'refunded', which a late payment would read as settled).
    assertEquals(order().payment.status, 'failed');
    assertEquals(order().payment.refundAmount, undefined);
    assertEquals(order().payment.refundedAt, undefined);
    assertEquals(typeof order().payment.failedAt, 'string');
    assertEquals(order().payment.lastEvent, 'customer_cancelled_full_refund', 'the cancel reason is kept');
    assertEquals(order().payment.reference, REFERENCE);
    assertEquals(db.PaymentTransaction[0].status, 'failed', 'the ledger follows the order');
    assertEquals(db.PaymentTransaction[0].lastError, 'customer_cancelled');
    assertEquals(order().needsAttention, false);
    assertEquals(refundAlerts().length, 0);
    assertEquals(adminAlertEmails().length, 0);
    assertEquals(promoReleases().length, 1, 'the promo slot is still released');
  });
});

Deno.test('customer cancel of a new-style unpaid checkout (capturedAmount 0, paidAt null) records no refund', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        status: 'placed',
        payment: {
          method: 'bank_transfer',
          provider: 'paystack',
          reference: REFERENCE,
          status: 'pending',
          capturedAmount: 0,
          paidAt: null,
          refundAmount: 0,
          refundedAt: null,
        },
      })
    );
    db.PaymentTransaction[0].status = 'pending';
    const response = await customerCancel();
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.data.refundAmount, 0, 'the app is told no refund was recorded');
    assertEquals(body.data.refundRate, 1, 'the policy rate is still reported');
    assertEquals(order().payment.status, 'failed');
    assertEquals(order().payment.refundAmount, 0);
    assertEquals(order().payment.refundedAt, null);
    assertEquals(db.PaymentTransaction[0].status, 'failed');
    assertEquals(order().needsAttention, false);
    assertEquals(refundAlerts().length, 0);
  });
});

Deno.test('customer cancel of one order of an unpaid group leaves the shared ledger row while another order is open', async () => {
  await withHarness(async () => {
    const unpaid = { method: 'bank_transfer', provider: 'paystack', reference: REFERENCE, status: 'pending', capturedAmount: 0, paidAt: null };
    setup(makeOrder({ status: 'placed', orderGroupId: 'group-1', payment: unpaid }));
    db.CustomerOrder.push(makeOrder({ id: 'order-guard-2', status: 'placed', orderGroupId: 'group-1', payment: unpaid }));
    db.PaymentTransaction[0].status = 'pending';

    const response = await customerCancel();
    assertEquals(response.status, 200);
    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'failed');
    assertEquals(db.PaymentTransaction[0].status, 'pending', 'the other restaurant is still waiting on this transfer');
  });
});

Deno.test('customer cancel of the last open order of an unpaid group marks the shared ledger row failed', async () => {
  await withHarness(async () => {
    const unpaid = { method: 'bank_transfer', provider: 'paystack', reference: REFERENCE, status: 'pending', capturedAmount: 0, paidAt: null };
    setup(makeOrder({ status: 'placed', orderGroupId: 'group-1', payment: unpaid }));
    db.CustomerOrder.push(
      makeOrder({ id: 'order-guard-2', status: 'cancelled', orderGroupId: 'group-1', payment: { ...unpaid, status: 'failed' } })
    );
    db.PaymentTransaction[0].status = 'pending';

    const response = await customerCancel();
    assertEquals(response.status, 200);
    assertEquals(db.PaymentTransaction[0].status, 'failed');
  });
});

Deno.test('customer cancel of a PAID order still records the refund and tells the app its amount', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'placed' }));
    const response = await customerCancel();
    const body = await response.json();
    assertEquals(body.data.refundAmount, CAPTURED);
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().payment.refundAmount, CAPTURED);
    assertEquals(typeof order().payment.refundedAt, 'string');
    assertEquals(db.PaymentTransaction[0].status, 'paid', 'ledger untouched, as before');
  });
});

// ───────────────────────── Spec 9: delivery-code attempts ─────────────────────────

Deno.test('delivery code: a correct code does not use an attempt', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'on_the_way', deliveryCodeAttempts: 2 }), riderAssignment());
    const response = await dispatchAction('delivered', { deliveryCode: '1234' });
    assertEquals(response.status, 200);
    assertEquals(order().status, 'delivered');
    assertEquals(order().deliveryCodeAttempts, 2);
  });
});

Deno.test('delivery code: a correct code rejected with 409 (the twin request already delivered) does not use an attempt', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'on_the_way' }), riderAssignment());
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'delivered',
      run: () => {
        order().status = 'delivered';
      },
    };
    const error = await expectFailure(() => dispatchAction('delivered', { deliveryCode: '1234' }));
    assertEquals(error.status, 409);
    assertEquals(order().deliveryCodeAttempts, 0);
  });
});

Deno.test('delivery code: only a wrong code uses an attempt', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'on_the_way' }), riderAssignment());
    const error = await expectFailure(() => dispatchAction('delivered', { deliveryCode: '9999' }));
    assertEquals(error.status, 400);
    assertEquals(order().deliveryCodeAttempts, 1);
    assertEquals(order().status, 'on_the_way');
  });
});

Deno.test('delivery code: a concurrent wrong guess that took the next slot is never erased by the correct one', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'on_the_way' }), riderAssignment());
    // Between this request reserving slot 1 and handing it back, a wrong guess
    // reserves slot 2. The hand-back's compare-and-set must not rewind to 0.
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.deliveryCodeAttempts === 0,
      run: () => {
        order().deliveryCodeAttempts = 2;
      },
    };
    const response = await dispatchAction('delivered', { deliveryCode: '1234' });
    assertEquals(response.status, 200);
    assertEquals(order().deliveryCodeAttempts, 2);
  });
});

// ───────────────────────── automatic Paystack refunds (auto_refunds flag) ─────────────────────────

const PAYSTACK_REFUND_URL = 'https://api.paystack.co/refund';

/** Routes api.paystack.co to `paystack` and records every Paystack refund request body. */
const stubPaystack = (paystack: () => Response) => {
  const refundBodies: Row[] = [];
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    if (String(input).startsWith('https://api.paystack.co/refund?')) {
      return Promise.resolve(new Response(JSON.stringify({ status: true, data: [], meta: { pageCount: 1 } }), { status: 200 }));
    }
    if (String(input) === PAYSTACK_REFUND_URL) {
      refundBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return Promise.resolve(paystack());
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;
  return refundBodies;
};

const paystackAccepts = () => new Response(JSON.stringify({ status: true, data: { id: 501, status: 'pending' } }), { status: 200 });

const autoRefundsOn = () => {
  db.FeatureFlag = [{ key: 'auto_refunds', enabled: true }];
  // What the payment verification stores, which the existing-refund check reads.
  order().payment = { ...order().payment, paidAt: new Date().toISOString(), paystackResponse: { amount: CAPTURED * 100, id: 7001 } };
};

Deno.test('auto_refunds off (the default): a paid rejection records the refund and sends nothing to Paystack', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'accepted' }));
    Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');
    Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_not_real');
    const refundBodies = stubPaystack(paystackAccepts);
    const response = await partnerAction('reject');
    assertEquals(response.status, 200);
    assertEquals(order().payment.status, 'refunded');
    assertEquals(refundBodies.length, 0, 'no Paystack call with the flag off');
    assertEquals(order().payment.refundExecution, undefined);
    assertEquals(String(refundAlerts()[0].details).includes('Refund via Paystack'), true, 'the alert points at the button');
  });
});

Deno.test('auto_refunds on: a paid rejection is refunded through Paystack once, for the recorded amount', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'accepted' }));
    autoRefundsOn();
    Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');
    Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_not_real');
    const refundBodies = stubPaystack(paystackAccepts);
    const response = await partnerAction('reject');
    assertEquals(response.status, 200);
    assertEquals(order().status, 'rejected');
    assertEquals(refundBodies.length, 1);
    assertEquals(refundBodies[0].amount, CAPTURED * 100);
    assertEquals(refundBodies[0].transaction, REFERENCE);
    assertEquals(order().payment.refundExecution.status, 'pending');
    assertEquals(order().payment.refundExecution.requestedBy, 'auto');
    assertEquals(String(refundAlerts()[0].details).includes('automatically'), true, 'admins are told not to refund by hand');
  });
});

Deno.test('auto_refunds on but Paystack refuses: the rejection still succeeds and the manual alert path stays', async () => {
  for (const paystack of [
    () => new Response(JSON.stringify({ status: false, message: 'Insufficient balance' }), { status: 400 }),
    () => new Response('gateway down', { status: 502 }),
  ]) {
    await withHarness(async () => {
      setup(makeOrder({ status: 'accepted' }));
      autoRefundsOn();
      Deno.env.set('PAYSTACK_SECRET_KEY', 'sk_test_not_real');
      Deno.env.set('PAYSTACK_PUBLIC_KEY', 'pk_test_not_real');
      stubPaystack(paystack);
      const response = await partnerAction('reject');
      assertEquals(response.status, 200, 'the reject is never turned into an error');
      assertEquals(order().status, 'rejected');
      assertEquals(order().payment.status, 'refunded', 'the refund record stands');
      assertEquals(order().needsAttention, true);
      assertEquals(refundAlerts().length, 1, 'the manual refund alert is still raised');
      const followUp = db.OperationalAlert.filter(
        (alert) => alert.alertType === 'refund_failed' || alert.alertType === 'refund_needs_attention'
      );
      assertEquals(followUp.length, 1, 'and the failure has its own alert');
    });
  }
});

Deno.test('auto_refunds on: an unpaid (cash) rejection never reaches Paystack', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'accepted', payment: { method: 'cash', provider: 'cash_on_delivery', status: 'pending' } }));
    autoRefundsOn();
    const refundBodies = stubPaystack(paystackAccepts);
    const response = await partnerAction('reject');
    assertEquals(response.status, 200);
    assertEquals(refundBodies.length, 0);
  });
});
