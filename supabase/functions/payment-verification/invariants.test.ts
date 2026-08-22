import { validatePaystackVerificationForOrder } from './invariants.ts';

const order = {
  id: 'order-1',
  payment: {
    reference: 'FEASTY-CRD-ORDER-1',
  },
  pricing: {
    total: 2500,
  },
};

const assertThrowsMessage = (work: () => void, expectedMessage: string) => {
  try {
    work();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return;
    }

    throw error;
  }

  throw new Error(`Expected error containing "${expectedMessage}"`);
};

Deno.test('rejects a requested reference that does not match the order reference', () => {
  assertThrowsMessage(
    () =>
      validatePaystackVerificationForOrder({
        order,
        paymentReference: 'FEASTY-CRD-OTHER',
        transactionData: {
          amount: 250000,
          reference: 'FEASTY-CRD-OTHER',
          status: 'success',
        },
      }),
    'Payment reference does not match the order'
  );
});

Deno.test('rejects a verified Paystack reference that does not match the order reference', () => {
  assertThrowsMessage(
    () =>
      validatePaystackVerificationForOrder({
        order,
        paymentReference: 'FEASTY-CRD-ORDER-1',
        transactionData: {
          amount: 250000,
          reference: 'FEASTY-CRD-OTHER',
          status: 'success',
        },
      }),
    'Verified Paystack reference does not match the order'
  );
});

Deno.test('accepts a successful Paystack transaction bound to the same order reference and amount', () => {
  validatePaystackVerificationForOrder({
    order,
    paymentReference: 'FEASTY-CRD-ORDER-1',
    transactionData: {
      amount: 250000,
      reference: 'FEASTY-CRD-ORDER-1',
      status: 'success',
    },
  });
});

// Task 17 (G1): a promo order carries a DISCOUNTED pricing.total (the discount
// is already folded into total by _shared/pricing.ts), so the gateway must have
// charged that discounted total to the kobo — not the pre-discount amount.
const promoOrder = {
  id: 'order-promo-1',
  payment: { reference: 'FEASTY-CRD-PROMO-1' },
  // 12200 subtotal − 1220 discount = 10980 ⇒ 1_098_000 kobo.
  pricing: { total: 10980, discount: 1220 },
};

Deno.test('accepts a promo-discounted order when the gateway charged the discounted total to the kobo', () => {
  validatePaystackVerificationForOrder({
    order: promoOrder,
    paymentReference: 'FEASTY-CRD-PROMO-1',
    transactionData: {
      amount: 1098000,
      reference: 'FEASTY-CRD-PROMO-1',
      status: 'success',
    },
  });
});

Deno.test('rejects a promo order where the gateway charged the PRE-discount amount (discount not honored)', () => {
  assertThrowsMessage(
    () =>
      validatePaystackVerificationForOrder({
        order: promoOrder,
        paymentReference: 'FEASTY-CRD-PROMO-1',
        transactionData: {
          amount: 1220000, // 12200 pre-discount, not the 10980 discounted total
          reference: 'FEASTY-CRD-PROMO-1',
          status: 'success',
        },
      }),
    'Amount mismatch'
  );
});
