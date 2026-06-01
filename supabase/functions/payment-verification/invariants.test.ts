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
