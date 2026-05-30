import { resolveWebhookOrderIdForReference } from './invariants.ts';

Deno.test('ignores metadata order id when it does not own the payment reference', () => {
  const result = resolveWebhookOrderIdForReference({
    metadataOrderId: 'order-from-webhook',
    transactionOrderId: 'order-from-payment-record',
  });

  if (!result.ignored || result.reason !== 'reference_order_mismatch') {
    throw new Error(`Expected reference_order_mismatch, got ${JSON.stringify(result)}`);
  }
});

Deno.test('accepts the order id that owns the stored payment reference', () => {
  const result = resolveWebhookOrderIdForReference({
    metadataOrderId: 'order-from-payment-record',
    transactionOrderId: 'order-from-payment-record',
  });

  if (result.ignored || result.orderId !== 'order-from-payment-record') {
    throw new Error(`Expected accepted payment owner, got ${JSON.stringify(result)}`);
  }
});
