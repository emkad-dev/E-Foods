import { assertEquals } from 'jsr:@std/assert';
import { isRefundEvent, parseRefundWebhook } from './refunds.ts';

Deno.test('the five Paystack refund events are routed, nothing else', () => {
  for (const event of ['refund.pending', 'refund.processing', 'refund.needs-attention', 'refund.processed', 'refund.failed']) {
    assertEquals(isRefundEvent(event), true, event);
  }
  for (const event of ['charge.success', 'transfer.success', 'refund.reversed', '']) {
    assertEquals(isRefundEvent(event), false, event);
  }
});

Deno.test("Paystack's documented refund event becomes the apply input", () => {
  // The refund.pending example from https://paystack.com/docs/payments/refunds/
  const parsed = parseRefundWebhook('refund.pending', {
    amount: '10000',
    currency: 'NGN',
    customer: { email: 'customer@example.test', first_name: 'Drew', last_name: 'Berry' },
    domain: 'live',
    integration: 412829,
    processor: 'instant-transfer',
    refund_reference: null,
    status: 'pending',
    transaction_reference: 'tvunjbbd_412829_4b18075d_c7had',
  });
  assertEquals(parsed, {
    amountKobo: 10000,
    paystackRefundId: null,
    reason: null,
    refundReference: null,
    status: 'refund.pending',
    transactionReference: 'tvunjbbd_412829_4b18075d_c7had',
  });
});

Deno.test('our refund reference, the Paystack id and a failure reason are carried', () => {
  const parsed = parseRefundWebhook('refund.failed', {
    amount: 430000,
    id: 3018284,
    reason: 'Customer account closed',
    refund_reference: 'feasty_rf_abc_1',
    transaction_reference: 'FEASTY-CRD-1',
  });
  assertEquals(parsed.amountKobo, 430000);
  assertEquals(parsed.paystackRefundId, '3018284');
  assertEquals(parsed.reason, 'Customer account closed');
  assertEquals(parsed.refundReference, 'feasty_rf_abc_1');
  assertEquals(parsed.status, 'refund.failed');
});

Deno.test('a transaction object stands in for a missing transaction_reference', () => {
  const parsed = parseRefundWebhook('refund.processed', { amount: 'not-a-number', transaction: { reference: 'T-1' } });
  assertEquals(parsed.transactionReference, 'T-1');
  assertEquals(parsed.amountKobo, null);
});
