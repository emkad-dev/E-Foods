// The admin way out for stuck orders (order-flow fixes, Spec 10). Drives the
// REAL adminForceCancelOrder / adminForceCompleteOrder / adminResolveOrderReport
// out of the REAL admin domain map, and the dispatch `cancel_escalated`
// write-off out of the REAL dispatch domain map, against one in-memory fake of
// the tables they touch. Asserts the STORED rows: status, the recorded refund,
// needsAttention, the confirmation fields, OperationalAlert and AdminAuditLog
// rows, DeliveryEvent rows and the promo release.
//
// Races are staged with a hook that runs just before a matching UPDATE is
// evaluated - the moment a concurrent writer's commit would land between the
// handler's read and its compare-and-set. The fake then applies every filter of
// the UPDATE together, the way Postgres re-evaluates the WHERE under the lock.
//
// Runs in package.json's --no-check `deno test` group: the domain modules
// import _shared/client.ts, which throws at module scope without these env vars.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

import { assertEquals } from 'jsr:@std/assert';

const { serviceClient } = await import('./client.ts');
const { adminDomain } = await import('./domains/admin.ts');
const { dispatchDomain } = await import('./domains/dispatch.ts');

const forceCancel = adminDomain.handlers.adminForceCancelOrder;
const forceComplete = adminDomain.handlers.adminForceCompleteOrder;
const resolveReport = adminDomain.handlers.adminResolveOrderReport;
const dispatchUpdateOrderStatus = dispatchDomain.handlers.dispatchUpdateOrderStatus;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type UpdateHook = { when: (table: string, payload: Row) => boolean; run: () => void };

let db: Record<string, Row[]> = {};
let rpcCalls: Array<{ fn: string; params: Row }> = [];
let updateHook: UpdateHook | null = null;
// Tables whose INSERT returns an error (a failing audit or event write).
let failingInsertTables = new Set<string>();

const ORDER_ID = 'order-admin-1';
const REFERENCE = 'FEASTY-CRD-ADMIN-1';
const ADMIN_UID = 'admin-1';
const PARTNER_UID = 'partner-user-1';
const RIDER_UID = 'rider-admin-1';
const CUSTOMER_UID = 'cust-admin-1';
const CAPTURED = 4300;
const HOUR_MS = 60 * 60 * 1000;

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
    if (op === 'insert' && failingInsertTables.has(table)) {
      return Promise.resolve({ data: null, error: { message: `${table} insert failed` } });
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
    range: () => builder,
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
  id: ORDER_ID,
  customerId: CUSTOMER_UID,
  restaurantId: 'rest-1',
  restaurantName: 'Test Kitchen',
  orderGroupId: null,
  status: 'accepted',
  fulfillmentType: 'pickup',
  needsAttention: false,
  customerIssueReportedAt: null,
  customerConfirmDueAt: null,
  customerConfirmedAt: null,
  customerConfirmationSource: null,
  payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'paid', capturedAmount: CAPTURED },
  pricing: { total: CAPTURED },
  timeline: { placedAt: new Date().toISOString() },
  cancellation: null,
  deliveryCode: '1234',
  deliveryCodeAttempts: 0,
  deliveryCodeVerifiedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: '2026-11-09T11:00:00.000Z',
  ...overrides,
});

const riderAssignment = (): Row => ({
  orderId: ORDER_ID,
  courierId: RIDER_UID,
  courierName: 'Ada Rider',
  dispatchId: null,
  dispatchOwnerId: RIDER_UID,
  assignedAt: new Date().toISOString(),
  loadReleasedAt: null,
});

const setup = (order: Row, assignment: Row | null = null) => {
  db = {
    AdminAuditLog: [],
    CustomerOrder: [structuredClone(order)],
    OrderItem: [],
    DeliveryAssignment: assignment ? [structuredClone(assignment)] : [],
    DeliveryEvent: [],
    PaymentTransaction: [{ id: REFERENCE, reference: REFERENCE, orderId: ORDER_ID, status: 'paid', amount: CAPTURED }],
    OperationalAlert: [],
    RestaurantRecord: [{ id: 'rest-1', ownerId: PARTNER_UID, name: 'Test Kitchen', updatedAt: new Date().toISOString() }],
    RestaurantApproval: [],
    UserRole: [{ userId: ADMIN_UID, role: 'admin', restaurantId: null }],
    UserAccount: [],
  };
  rpcCalls = [];
  failingInsertTables = new Set();
  updateHook = null;
};

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

const asAdmin = (handler: unknown, data: Row) => call(handler, contextFor(ADMIN_UID, 'admin'), { orderId: ORDER_ID, ...data });

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
const audits = (action: string) => db.AdminAuditLog.filter((entry) => entry.action === action);
const promoReleases = () => rpcCalls.filter((c) => c.fn === 'ebuy_release_promo_redemption' && c.params.p_order_id === ORDER_ID);
const loadReleases = () => rpcCalls.filter((c) => c.fn === 'ebuy_release_dispatch_assignment_load' && c.params.p_order_id === ORDER_ID);
const adminAlertEmails = () =>
  rpcCalls.filter((c) => c.fn === 'auth_rl_hit' && c.params.p_key === `admin-alert-email:manual_refund_required:${ORDER_ID}`);
const refundAlerts = () => db.OperationalAlert.filter((alert) => alert.alertType === 'manual_refund_required');

/** Nothing a lost race may leave behind. */
const assertNoSideEffects = () => {
  assertEquals(db.AdminAuditLog.length, 0, 'no audit entry');
  assertEquals(db.DeliveryEvent.length, 0, 'no timeline event');
  assertEquals(promoReleases().length, 0, 'no promo release');
  assertEquals(refundAlerts().length, 0, 'no alert');
  assertEquals(adminAlertEmails().length, 0, 'no admin email');
};

// ───────────────────────── role and input checks ─────────────────────────

Deno.test('the three admin order actions refuse every non-admin role and change nothing', async () => {
  await withHarness(async () => {
    for (const [handler, data] of [
      [forceCancel, { reason: 'stuck' }],
      [forceComplete, { reason: 'stuck' }],
      [resolveReport, { note: 'sorted' }],
    ] as const) {
      for (const role of ['restaurant', 'dispatch', 'customer']) {
        setup(makeOrder({ status: 'preparing', needsAttention: true, customerIssueReportedAt: '2026-11-09T10:00:00Z' }));
        const error = await expectFailure(() => call(handler, contextFor('someone', role), { orderId: ORDER_ID, ...data }));
        assertEquals(error.status, 403, role);
        assertEquals(order().status, 'preparing');
        assertEquals(order().needsAttention, true);
        assertEquals(db.AdminAuditLog.length, 0);
      }
    }
  });
});

Deno.test('a reason (or note) is required, trimmed and capped at 500 characters', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'preparing' }));
    for (const reason of [undefined, '', '   ', '\u0000\u0007']) {
      const error = await expectFailure(() => asAdmin(forceCancel, { reason }));
      assertEquals(error.status, 400, JSON.stringify(reason));
    }
    const tooLong = await expectFailure(() => asAdmin(forceComplete, { reason: 'x'.repeat(501) }));
    assertEquals(tooLong.status, 400);
    const noNote = await expectFailure(() => asAdmin(resolveReport, { note: ' ' }));
    assertEquals(noNote.status, 400);
    assertEquals(order().status, 'preparing', 'nothing written');

    const response = await asAdmin(forceComplete, { reason: `  ${'y'.repeat(500)}  ` });
    assertEquals(response.status, 200, 'exactly 500 characters after trimming is accepted');
    assertEquals(audits('order_force_completed')[0].details.reason, 'y'.repeat(500));
  });
});

// ───────────────────────── force-cancel ─────────────────────────

Deno.test('force-cancel of a PAID order records the full refund, flags attention, frees the promo, raises one alert and is audited', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'preparing' }));
    const response = await asAdmin(forceCancel, { reason: '  Kitchen closed, customer called  ' });
    assertEquals(response.status, 200);

    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().payment.refundAmount, CAPTURED, 'full refund (rate 1)');
    assertEquals(order().payment.lastEvent, 'admin_force_cancel_full_refund');
    assertEquals(order().payment.reference, REFERENCE);
    assertEquals(order().needsAttention, true, 'a human must return the money');
    assertEquals(order().cancellation, { actor: 'admin', reason: 'admin_force_cancel', refundRate: 1 });
    assertEquals(typeof order().timeline.cancelledAt, 'string');

    assertEquals(promoReleases().length, 1);
    assertEquals(refundAlerts().length, 1, 'one OperationalAlert');
    assertEquals(String(refundAlerts()[0].details).includes('cancelled by an admin'), true);
    assertEquals(String(refundAlerts()[0].details).includes('A refund of'), true);
    assertEquals(adminAlertEmails().length, 1);
    assertEquals(loadReleases().length, 1, 'rider load released');

    assertEquals(audits('order_force_cancelled').length, 1);
    assertEquals(audits('order_force_cancelled')[0].actorUid, ADMIN_UID);
    assertEquals(audits('order_force_cancelled')[0].targetId, ORDER_ID);
    assertEquals(audits('order_force_cancelled')[0].details.reason, 'Kitchen closed, customer called');
    assertEquals(audits('order_force_cancelled')[0].details.refundRecorded, true);
    assertEquals(events('admin_force_cancelled').length, 1);
    assertEquals(events('admin_force_cancelled')[0].note, 'Kitchen closed, customer called');
    assertEquals(db.PaymentTransaction[0].status, 'paid', 'ledger untouched, as every recorded refund leaves it');
  });
});

Deno.test('force-cancel of an UNPAID escalated order simply cancels it: no refund, no alert, the stale flag cleared', async () => {
  await withHarness(async () => {
    const unpaid = { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'pending' };
    setup(makeOrder({ status: 'placed', needsAttention: true, payment: unpaid }));
    const response = await asAdmin(forceCancel, { reason: 'Never paid' });
    assertEquals(response.status, 200);
    assertEquals(order().status, 'cancelled');
    // The same closed shape a customer cancel writes: failed, no refund. A
    // 'pending' payment here showed the customer "Pending" and a refresh button.
    assertEquals(order().payment.status, 'failed');
    assertEquals(typeof order().payment.failedAt, 'string');
    assertEquals(order().payment.lastEvent, 'admin_force_cancel');
    assertEquals(order().payment.reference, REFERENCE, 'the rest of the payment is kept');
    assertEquals('refundAmount' in order().payment, false, 'no refund recorded');
    assertEquals('refundedAt' in order().payment, false);
    assertEquals(order().needsAttention, false, 'the terminal write clears the escalation flag');
    assertEquals(order().cancellation, { actor: 'admin', reason: 'admin_force_cancel' });
    assertEquals(refundAlerts().length, 0);
    assertEquals(adminAlertEmails().length, 0);
    assertEquals(promoReleases().length, 1, 'the promo slot is still freed');
    assertEquals(audits('order_force_cancelled')[0].details.refundRecorded, false);
  });
});

Deno.test('force-cancel of one order of an unpaid group leaves the shared ledger row while another order is open', async () => {
  await withHarness(async () => {
    const unpaid = { method: 'bank_transfer', provider: 'paystack', reference: REFERENCE, status: 'pending', capturedAmount: 0, paidAt: null };
    setup(makeOrder({ status: 'placed', orderGroupId: 'group-1', payment: unpaid }));
    db.CustomerOrder.push(makeOrder({ id: 'order-admin-2', status: 'placed', orderGroupId: 'group-1', payment: unpaid }));
    db.PaymentTransaction[0].status = 'pending';
    assertEquals((await asAdmin(forceCancel, { reason: 'Never paid' })).status, 200);
    assertEquals(order().payment.status, 'failed');
    assertEquals(db.PaymentTransaction[0].status, 'pending', 'the other order still waits on this transfer');

    // Once every other order of the group has closed, the row follows.
    setup(makeOrder({ status: 'placed', orderGroupId: 'group-1', payment: unpaid }));
    db.CustomerOrder.push(makeOrder({ id: 'order-admin-2', status: 'cancelled', orderGroupId: 'group-1', payment: unpaid }));
    db.PaymentTransaction[0].status = 'pending';
    assertEquals((await asAdmin(forceCancel, { reason: 'Never paid' })).status, 200);
    assertEquals(db.PaymentTransaction[0].status, 'failed');
  });
});

Deno.test('force-cancel of an UNPAID order marks its pending payment transaction failed, never a captured one', async () => {
  await withHarness(async () => {
    for (const ledgerStatus of ['pending', 'failed']) {
      setup(makeOrder({ status: 'placed', payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: ledgerStatus } }));
      db.PaymentTransaction[0].status = ledgerStatus;
      assertEquals((await asAdmin(forceCancel, { reason: 'Never paid' })).status, 200);
      assertEquals(db.PaymentTransaction[0].status, 'failed', `${ledgerStatus} -> failed`);
      assertEquals(db.PaymentTransaction[0].lastError, 'admin_force_cancel');
      assertEquals(typeof db.PaymentTransaction[0].failedAt, 'string');
    }

    // A capture the ledger recorded after the order was read (the webhook wrote
    // the ledger but the order still says pending) is never overwritten.
    setup(makeOrder({ status: 'placed', payment: { method: 'card', provider: 'paystack', reference: REFERENCE, status: 'pending' } }));
    assertEquals((await asAdmin(forceCancel, { reason: 'Never paid' })).status, 200);
    assertEquals(db.PaymentTransaction[0].status, 'paid', 'a paid ledger row is left alone');
    assertEquals(db.PaymentTransaction[0].lastError, undefined);
  });
});

Deno.test('force-cancel works from a rider-held status and refuses an order that has already ended', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'on_the_way', fulfillmentType: 'delivery' }), riderAssignment());
    assertEquals((await asAdmin(forceCancel, { reason: 'Rider crashed' })).status, 200);
    assertEquals(order().status, 'cancelled');

    for (const status of ['delivered', 'cancelled', 'rejected', 'failed_delivery']) {
      setup(makeOrder({ status }));
      const error = await expectFailure(() => asAdmin(forceCancel, { reason: 'x' }));
      assertEquals(error.status, 412, status);
      assertEquals(order().status, status);
      assertNoSideEffects();
    }
  });
});

Deno.test('a failing audit and event write on a paid platform force-cancel skips no side effect and still succeeds', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({ status: 'on_the_way', fulfillmentType: 'delivery', pricing: { total: CAPTURED, deliveryProvider: 'platform' } }),
      riderAssignment()
    );
    failingInsertTables = new Set(['AdminAuditLog', 'DeliveryEvent']);
    const response = await asAdmin(forceCancel, { reason: 'Rider unreachable' });
    assertEquals(response.status, 200, 'a done action is reported as done');
    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().needsAttention, true);
    assertEquals(loadReleases().length, 1, 'rider load released');
    assertEquals(refundAlerts().length, 1, 'alert raised');
    assertEquals(adminAlertEmails().length, 1, 'admins told');
    assertEquals(promoReleases().length, 1, 'promo released');
    assertEquals(db.AdminAuditLog.length, 0);
  });
});

Deno.test('a failing audit write on force-complete and resolve still reports success', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'preparing' }));
    failingInsertTables = new Set(['AdminAuditLog']);
    assertEquals((await asAdmin(forceComplete, { reason: 'x' })).status, 200);
    assertEquals(order().status, 'delivered');
    assertEquals(loadReleases().length, 1);
    assertEquals(events('admin_force_completed').length, 1, 'the event still lands when only the audit fails');

    setup(makeOrder({ status: 'rejected', needsAttention: true }));
    failingInsertTables = new Set(['AdminAuditLog']);
    assertEquals((await asAdmin(resolveReport, { note: 'x' })).status, 200);
    assertEquals(order().needsAttention, false);
  });
});

Deno.test('force-cancel losing its compare-and-set to a status change changes nothing', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'preparing' }));
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'cancelled',
      run: () => {
        order().status = 'ready_for_pickup';
      },
    };
    const error = await expectFailure(() => asAdmin(forceCancel, { reason: 'x' }));
    assertEquals(error.status, 409);
    assertEquals(order().status, 'ready_for_pickup');
    assertEquals(order().payment.status, 'paid', 'no refund recorded');
    assertEquals(order().needsAttention, false);
    assertNoSideEffects();
  });
});

Deno.test('force-cancel losing to a payment confirmation does not cancel the now-paid order', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'placed', payment: { method: 'card', reference: REFERENCE, status: 'pending' } }));
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'cancelled',
      run: () => {
        order().payment = { ...order().payment, status: 'paid', capturedAmount: CAPTURED };
      },
    };
    const error = await expectFailure(() => asAdmin(forceCancel, { reason: 'x' }));
    assertEquals(error.status, 409);
    assertEquals(order().status, 'placed');
    assertEquals(order().payment.status, 'paid');
    assertNoSideEffects();
  });
});

// ───────────────────────── force-complete ─────────────────────────

Deno.test('force-complete of a pickup sets delivered with the 3-hour customer-confirmation deadline and is audited', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'preparing', needsAttention: true }));
    const before = Date.now();
    const response = await asAdmin(forceComplete, { reason: 'Customer collected, tablet died' });
    assertEquals(response.status, 200);

    assertEquals(order().status, 'delivered');
    const dueMs = Date.parse(order().customerConfirmDueAt);
    const deliveredMs = Date.parse(order().timeline.deliveredAt);
    assertEquals(dueMs - deliveredMs, 3 * HOUR_MS, 'the same window the partner delivered action starts');
    assertEquals(deliveredMs >= before, true);
    assertEquals(order().timeline.readyAt, order().timeline.deliveredAt, 'readyAt filled when the kitchen never marked it');
    assertEquals(order().customerConfirmedAt, null, 'the customer can still confirm or report');
    assertEquals(order().needsAttention, false, 'the terminal write clears a stale flag');
    assertEquals(order().payment.status, 'paid', 'money untouched');

    assertEquals(audits('order_force_completed').length, 1);
    assertEquals(audits('order_force_completed')[0].details.previousStatus, 'preparing');
    assertEquals(events('admin_force_completed')[0].note, 'Customer collected, tablet died');
    assertEquals(loadReleases().length, 1);
    assertEquals(refundAlerts().length, 0);
  });
});

Deno.test('force-complete: restaurant-run delivery from the kitchen stages, a FEASTY rider delivery only from on_the_way', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'ready_for_pickup', fulfillmentType: 'delivery', pricing: { total: CAPTURED, deliveryProvider: 'restaurant' } }));
    assertEquals((await asAdmin(forceComplete, { reason: 'x' })).status, 200);
    assertEquals(order().status, 'delivered');

    const platform = { fulfillmentType: 'delivery', pricing: { total: CAPTURED, deliveryProvider: 'platform' } };
    setup(makeOrder({ status: 'ready_for_pickup', ...platform }), riderAssignment());
    const refused = await expectFailure(() => asAdmin(forceComplete, { reason: 'x' }));
    assertEquals(refused.status, 412);
    assertEquals(refused.message?.includes('FEASTY rider'), true);
    assertEquals(order().status, 'ready_for_pickup');
    assertNoSideEffects();

    setup(makeOrder({ status: 'on_the_way', ...platform }), riderAssignment());
    assertEquals((await asAdmin(forceComplete, { reason: 'Code would not take' })).status, 200);
    assertEquals(order().status, 'delivered');
    assertEquals(typeof order().customerConfirmDueAt, 'string');
  });
});

Deno.test('force-complete refuses orders not yet accepted and orders that have ended', async () => {
  await withHarness(async () => {
    for (const status of ['placed', 'scheduled', 'escalated', 'delivered', 'cancelled']) {
      setup(makeOrder({ status }));
      const error = await expectFailure(() => asAdmin(forceComplete, { reason: 'x' }));
      assertEquals(error.status, 412, status);
      assertEquals(order().status, status);
      assertNoSideEffects();
    }
  });
});

Deno.test('force-complete losing its compare-and-set changes nothing', async () => {
  await withHarness(async () => {
    setup(makeOrder({ status: 'preparing' }));
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'delivered',
      run: () => {
        order().status = 'rejected';
      },
    };
    const error = await expectFailure(() => asAdmin(forceComplete, { reason: 'x' }));
    assertEquals(error.status, 409);
    assertEquals(order().status, 'rejected');
    assertEquals(order().customerConfirmDueAt, null);
    assertNoSideEffects();
  });
});

// ───────────────────────── resolve a customer report ─────────────────────────

const reportedOrder = (overrides: Row = {}) =>
  makeOrder({
    status: 'delivered',
    needsAttention: true,
    customerConfirmDueAt: '2026-11-09T14:00:00.000Z',
    customerIssueReportedAt: '2026-11-09T11:30:00.000Z',
    ...overrides,
  });

Deno.test('resolving a report clears the flag, records the resolution and closes the confirmation like the auto-close', async () => {
  await withHarness(async () => {
    setup(reportedOrder());
    const response = await asAdmin(resolveReport, { note: 'Refunded the missing drink by hand' });
    assertEquals(response.status, 200);

    assertEquals(order().needsAttention, false);
    assertEquals(order().customerConfirmationSource, 'auto', 'closed the way the 3-hour auto-close closes it');
    assertEquals(typeof order().customerConfirmedAt, 'string');
    assertEquals(order().timeline.reportResolvedAt, order().customerConfirmedAt);
    assertEquals(order().timeline.attentionResolvedAt, order().customerConfirmedAt);
    assertEquals(order().customerIssueReportedAt, '2026-11-09T11:30:00.000Z', 'the report itself is kept');
    assertEquals(order().status, 'delivered');

    assertEquals(audits('order_report_resolved').length, 1);
    assertEquals(audits('order_report_resolved')[0].details.note, 'Refunded the missing drink by hand');
    assertEquals(events('admin_report_resolved')[0].note, 'Refunded the missing drink by hand');
  });
});

Deno.test('resolving a report the customer already confirmed only clears the flag', async () => {
  await withHarness(async () => {
    setup(reportedOrder({ customerConfirmedAt: '2026-11-09T12:00:00.000Z', customerConfirmationSource: 'customer' }));
    assertEquals((await asAdmin(resolveReport, { note: 'ok' })).status, 200);
    assertEquals(order().needsAttention, false);
    assertEquals(order().customerConfirmedAt, '2026-11-09T12:00:00.000Z');
    assertEquals(order().customerConfirmationSource, 'customer');
  });
});

Deno.test('resolve refuses an order that is not flagged (a report already resolved, or nothing raised)', async () => {
  await withHarness(async () => {
    setup(reportedOrder({ needsAttention: false }));
    assertEquals((await expectFailure(() => asAdmin(resolveReport, { note: 'x' }))).status, 412);
    assertNoSideEffects();

    setup(makeOrder({ status: 'preparing', needsAttention: false }));
    assertEquals((await expectFailure(() => asAdmin(resolveReport, { note: 'x' }))).status, 412);
    assertNoSideEffects();
  });
});

Deno.test('a stale flag on a delivered pickup (no report) is cleared; no status or confirmation change', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        status: 'delivered',
        needsAttention: true,
        customerConfirmDueAt: '2026-11-09T14:00:00.000Z',
        customerConfirmedAt: null,
      })
    );
    const response = await asAdmin(resolveReport, { note: 'Late payment checked, nothing owed' });
    assertEquals(response.status, 200);
    assertEquals(order().needsAttention, false);
    assertEquals(order().status, 'delivered');
    assertEquals(order().customerConfirmedAt, null, 'no report: the confirmation flow is left to the customer');
    assertEquals(order().customerConfirmationSource, null);
    assertEquals(typeof order().timeline.attentionResolvedAt, 'string');
    assertEquals(order().timeline.reportResolvedAt, undefined);
    assertEquals(audits('order_attention_resolved')[0].details.note, 'Late payment checked, nothing owed');
    assertEquals(events('admin_attention_resolved').length, 1);
  });
});

Deno.test('the manual-refund flag on a rejected order can be marked resolved; the order stays rejected', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        status: 'rejected',
        needsAttention: true,
        payment: { method: 'card', reference: REFERENCE, status: 'refunded', refundAmount: CAPTURED },
      })
    );
    const response = await asAdmin(resolveReport, { note: 'Refund sent by bank transfer' });
    assertEquals(response.status, 200);
    assertEquals(order().needsAttention, false);
    assertEquals(order().status, 'rejected');
    assertEquals(order().payment.status, 'refunded', 'payment untouched');
    assertEquals(order().customerConfirmedAt, null);
    assertEquals(audits('order_attention_resolved').length, 1);
  });
});

Deno.test('resolve losing its compare-and-set to a customer confirm changes nothing', async () => {
  await withHarness(async () => {
    setup(reportedOrder());
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.needsAttention === false,
      run: () => {
        order().customerConfirmedAt = '2026-11-09T12:30:00.000Z';
        order().customerConfirmationSource = 'customer';
        order().updatedAt = '2026-11-09T12:30:00.000Z';
      },
    };
    const error = await expectFailure(() => asAdmin(resolveReport, { note: 'x' }));
    assertEquals(error.status, 409);
    assertEquals(order().needsAttention, true, 'still flagged');
    assertEquals(order().customerConfirmationSource, 'customer');
    assertEquals(order().timeline.reportResolvedAt, undefined);
    assertNoSideEffects();
  });
});

// ───────────────────────── dispatch cancel_escalated ─────────────────────────

Deno.test('cancel_escalated on a PAID order now flags attention, frees the promo and alerts admins (refund as before)', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({
        status: 'escalated',
        fulfillmentType: 'delivery',
        needsAttention: true,
        timeline: { escalatedAt: '2026-11-09T10:00:00Z', escalatedFrom: 'on_the_way' },
      }),
      riderAssignment()
    );
    const response = await call(dispatchUpdateOrderStatus, contextFor(ADMIN_UID, 'admin'), {
      action: 'cancel_escalated',
      orderId: ORDER_ID,
    });
    assertEquals(response.status, 200);

    assertEquals(order().status, 'cancelled');
    assertEquals(order().payment.status, 'refunded');
    assertEquals(order().payment.refundAmount, CAPTURED);
    assertEquals(order().payment.lastEvent, 'dispatch_escalation_cancelled_full_refund', 'same refund reason as before');
    assertEquals(order().cancellation, { actor: 'admin', reason: 'dispatch_escalation', refundRate: 1 }, 'same record as before');
    assertEquals(order().needsAttention, true, 'the money must be returned by hand');
    assertEquals(promoReleases().length, 1);
    assertEquals(refundAlerts().length, 1);
    assertEquals(adminAlertEmails().length, 1);
    assertEquals(loadReleases().length, 1, 'rider load still released');
    assertEquals(events('dispatch_cancel_escalated').length, 1);
  });
});

Deno.test('cancel_escalated losing a race to a payment change writes nothing and alerts nobody', async () => {
  await withHarness(async () => {
    setup(
      makeOrder({ status: 'escalated', fulfillmentType: 'delivery', timeline: { escalatedFrom: 'on_the_way' } }),
      riderAssignment()
    );
    updateHook = {
      when: (table, payload) => table === 'CustomerOrder' && payload.status === 'cancelled',
      run: () => {
        order().payment = { ...order().payment, status: 'refunded' };
      },
    };
    const error = await expectFailure(() =>
      call(dispatchUpdateOrderStatus, contextFor(ADMIN_UID, 'admin'), { action: 'cancel_escalated', orderId: ORDER_ID })
    );
    assertEquals(error.status, 409);
    assertEquals(order().status, 'escalated');
    assertEquals(refundAlerts().length, 0);
    assertEquals(promoReleases().length, 0);
  });
});
