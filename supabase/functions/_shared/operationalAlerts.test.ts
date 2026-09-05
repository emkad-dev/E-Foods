Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

import { assertEquals, assertStrictEquals } from 'jsr:@std/assert';

const [
  {
    captureAcceptanceDeadlineAlert,
    captureDispatchOffersExhaustedAlert,
    captureDispatchPoolEmptyAlert,
    capturePaymentWebhookFailureAlert,
    evaluateAcceptanceDeadlineAlert,
    evaluateDispatchOffersExhaustedAlert,
    evaluateDispatchPoolEmptyAlert,
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
