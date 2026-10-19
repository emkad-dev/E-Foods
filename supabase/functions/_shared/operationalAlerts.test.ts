Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

import { assertEquals, assertStrictEquals } from 'jsr:@std/assert';

const [
  {
    captureAcceptanceDeadlineAlert,
    captureDispatchOffersExhaustedAlert,
    captureDispatchPoolEmptyAlert,
    captureManualSettlementFallbackAlert,
    capturePaymentOnClosedOrderAlert,
    capturePaymentWebhookFailureAlert,
    evaluateAcceptanceDeadlineAlert,
    evaluateDispatchOffersExhaustedAlert,
    evaluateDispatchPoolEmptyAlert,
    evaluateManualSettlementFallbackAlert,
    evaluatePaymentOnClosedOrderAlert,
    evaluatePaymentWebhookFailureAlert,
    recordOperationalAlert,
  },
] = await Promise.all([import('./operationalAlerts.ts')]);

type UpsertCall = {
  onConflict?: string;
  payload: Record<string, unknown>;
};

const createOperationalAlertClient = (calls: UpsertCall[] = []) => ({
  from(table: string) {
    if (table !== 'OperationalAlert') {
      throw new Error(`unexpected table ${table}`);
    }

    return {
      async upsert(payload: Record<string, unknown>, opts?: { onConflict?: string }) {
        calls.push({ onConflict: opts?.onConflict, payload: { ...payload } });
        return { error: null };
      },
    };
  },
});

Deno.test('operational alert evaluators fire at threshold and stay silent below it', () => {
  assertEquals(evaluatePaymentWebhookFailureAlert({
    orderId: 'order-1',
    paymentReference: 'pay-1',
    reason: 'gateway timeout',
    retryCount: 2,
  }).alerts.length, 0);

  const paymentAlert = evaluatePaymentWebhookFailureAlert({
    orderId: 'order-1',
    paymentReference: 'pay-1',
    reason: 'gateway timeout',
    retryCount: 3,
  }).alerts[0];
  assertEquals(paymentAlert?.severity, 'medium');
  assertEquals(paymentAlert?.alertType, 'payment_webhook_failure_rate');

  const paymentHighAlert = evaluatePaymentWebhookFailureAlert({
    orderId: 'order-1',
    paymentReference: 'pay-1',
    reason: 'gateway timeout',
    retryCount: 5,
  }).alerts[0];
  assertEquals(paymentHighAlert?.severity, 'high');

  assertEquals(
    evaluateDispatchPoolEmptyAlert({ availableCount: 1, orderId: 'order-2', restaurantId: 'rest-1' }).alerts.length,
    0
  );
  assertEquals(
    evaluateDispatchPoolEmptyAlert({ availableCount: 0, orderId: 'order-2', restaurantId: 'rest-1' }).alerts[0]
      ?.dedupeKey,
    'ops:dispatch_pool_empty:order-2'
  );

  assertEquals(
    evaluateDispatchOffersExhaustedAlert({ maxOffers: 6, orderId: 'order-3', restaurantId: 'rest-1' }).alerts[0]
      ?.severity,
    'high'
  );
  assertEquals(
    evaluateAcceptanceDeadlineAlert({ orderId: 'order-4', restaurantId: 'rest-1' }).alerts[0]?.alertType,
    'acceptance_deadline_escalated'
  );
});

Deno.test('recordOperationalAlert upserts a stable dedupe key and keeps the latest payload', async () => {
  const writes: UpsertCall[] = [];
  const client = createOperationalAlertClient(writes);

  const first = await recordOperationalAlert(
    {
      alertType: 'dispatch_pool_empty',
      dedupeKey: 'ops:dispatch_pool_empty:order-1',
      details: 'No available dispatch rider could be found for order order-1.',
      metadata: { availableCount: 0, restaurantId: 'rest-1' },
      severity: 'medium',
      subjectId: 'order-1',
      subjectType: 'order',
      title: 'Dispatch pool empty',
    },
    client
  );
  const second = await recordOperationalAlert(
    {
      alertType: 'dispatch_pool_empty',
      dedupeKey: 'ops:dispatch_pool_empty:order-1',
      details: 'No available dispatch rider could be found for order order-1.',
      metadata: { availableCount: 0, restaurantId: 'rest-1' },
      severity: 'medium',
      subjectId: 'order-1',
      subjectType: 'order',
      title: 'Dispatch pool empty',
    },
    client
  );

  assertEquals(writes.length, 2);
  assertEquals(writes[0].payload.dedupeKey, 'ops:dispatch_pool_empty:order-1');
  assertEquals(writes[0].onConflict, 'dedupeKey');
  assertEquals(writes[1].payload.dedupeKey, 'ops:dispatch_pool_empty:order-1');
  assertStrictEquals(first?.dedupeKey, second?.dedupeKey);
  assertEquals(first?.alertType, 'dispatch_pool_empty');
});

Deno.test('best-effort capture helpers return the evaluated alerts', async () => {
  const calls: UpsertCall[] = [];
  const client = createOperationalAlertClient(calls);

  const paymentAlerts = await capturePaymentWebhookFailureAlert({
    orderId: 'order-5',
    paymentReference: 'pay-5',
    reason: 'gateway timeout',
    retryCount: 4,
  }, client);
  const dispatchAlerts = await captureDispatchPoolEmptyAlert({
    availableCount: 0,
    orderId: 'order-6',
    restaurantId: 'rest-1',
  }, client);
  const offersAlerts = await captureDispatchOffersExhaustedAlert({
    maxOffers: 6,
    orderId: 'order-7',
    restaurantId: 'rest-1',
  }, client);
  const acceptanceAlerts = await captureAcceptanceDeadlineAlert({
    orderId: 'order-8',
    restaurantId: 'rest-1',
  }, client);

  assertEquals(paymentAlerts[0]?.alertType, 'payment_webhook_failure_rate');
  assertEquals(dispatchAlerts[0]?.alertType, 'dispatch_pool_empty');
  assertEquals(offersAlerts[0]?.alertType, 'dispatch_offers_exhausted');
  assertEquals(acceptanceAlerts[0]?.alertType, 'acceptance_deadline_escalated');
  assertEquals(calls.length, 4);
});

const manualFallbackInput = {
  isMultiStore: false,
  orderId: 'order-9',
  paymentReference: 'FEASTY-CRD-ORDER-9',
  restaurantId: 'rest-9',
  restaurantName: 'Mama Put',
  settlementMode: 'manual',
};

Deno.test('manual settlement fallback alert: one deduped row per restaurant for a single-store manual payment', () => {
  const [alert] = evaluateManualSettlementFallbackAlert(manualFallbackInput).alerts;
  assertEquals(alert?.alertType, 'manual_settlement_fallback');
  assertEquals(alert?.dedupeKey, 'ops:manual_settlement_fallback:rest-9');
  assertEquals(alert?.subjectType, 'restaurant');
  assertEquals(alert?.subjectId, 'rest-9');

  // A second order for the SAME restaurant maps to the SAME dedupe key.
  const [again] = evaluateManualSettlementFallbackAlert({ ...manualFallbackInput, orderId: 'order-10' }).alerts;
  assertEquals(again?.dedupeKey, alert?.dedupeKey);
  // ...and a different restaurant to a different one.
  const [other] = evaluateManualSettlementFallbackAlert({ ...manualFallbackInput, restaurantId: 'rest-2' }).alerts;
  assertEquals(other?.dedupeKey, 'ops:manual_settlement_fallback:rest-2');
});

Deno.test('manual settlement fallback alert is silent for split settlement and for multi-store carts', () => {
  assertEquals(evaluateManualSettlementFallbackAlert({ ...manualFallbackInput, settlementMode: 'split' }).alerts.length, 0);
  assertEquals(evaluateManualSettlementFallbackAlert({ ...manualFallbackInput, isMultiStore: true }).alerts.length, 0);
  assertEquals(evaluateManualSettlementFallbackAlert({ ...manualFallbackInput, restaurantId: '' }).alerts.length, 0);
});

Deno.test('alert capture for the payment path is best-effort: a failing write never throws', async () => {
  const throwingClient = {
    from() {
      return {
        upsert() {
          throw new Error('db down');
        },
      };
    },
  };
  const errorClient = {
    from() {
      return { upsert: () => Promise.resolve({ error: { message: 'boom' } }) };
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await captureManualSettlementFallbackAlert(manualFallbackInput, throwingClient);
    await captureManualSettlementFallbackAlert(manualFallbackInput, errorClient);
    await capturePaymentOnClosedOrderAlert(
      { orderId: 'o', orderStatus: 'cancelled', paymentReference: 'r', restaurantId: 'rest-1' },
      throwingClient
    );
  } finally {
    console.error = originalConsoleError;
  }
});

Deno.test('payment-on-closed-order alert is high severity and keyed per order', () => {
  const [alert] = evaluatePaymentOnClosedOrderAlert({
    orderId: 'order-11',
    orderStatus: 'cancelled',
    paymentReference: 'FEASTY-CRD-ORDER-11',
    restaurantId: 'rest-1',
  }).alerts;
  assertEquals(alert?.alertType, 'payment_on_closed_order');
  assertEquals(alert?.severity, 'high');
  assertEquals(alert?.dedupeKey, 'ops:payment_on_closed_order:order-11');
});
