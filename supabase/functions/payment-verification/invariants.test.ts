import {
  resolveGroupExpectedTotal,
  validatePaystackVerificationForOrder,
} from './invariants.ts';
import { DEFAULT_PRICING_CONFIG, calculateOrderPricing, settlementBalanceResidual } from '../_shared/pricing.ts';

const order = {
  id: 'order-1',
  payment: {
    reference: 'FEASTY-CRD-ORDER-1',
  },
  pricing: {
    total: 2500,
  },
};

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
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

Deno.test('settlement balance stays exact for the settlement split', () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: 800,
    items: [{ basePrice: 5000, price: 6100, quantity: 2 }],
    tip: 100,
  });

  expectEqual(settlementBalanceResidual(pricing), 0, 'settlement balance residual');
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

// Multi-store checkout: ONE Paystack charge for the whole OrderGroup. The
// webhook resolves the PRIMARY order (first restaurant's), whose own
// pricing.total is only that restaurant's share -- the gateway charged the
// group total (prod example: group 12800, primary order 4300).
const groupPrimaryOrder = {
  id: 'order-group-1',
  payment: { reference: 'FEASTY-CRD-GROUP-1' },
  pricing: { total: 4300 },
};
const groupTransaction = {
  amount: 1280000, // 12800 naira group total
  reference: 'FEASTY-CRD-GROUP-1',
  status: 'success',
};

Deno.test('multi-store: the primary order alone cannot validate the group charge (documents why the group total is needed)', () => {
  assertThrowsMessage(
    () =>
      validatePaystackVerificationForOrder({
        order: groupPrimaryOrder,
        paymentReference: 'FEASTY-CRD-GROUP-1',
        transactionData: groupTransaction,
      }),
    'Amount mismatch: expected 430000, got 1280000'
  );
});

Deno.test('multi-store: accepts the group charge when validated against the group total', () => {
  validatePaystackVerificationForOrder({
    order: groupPrimaryOrder,
    paymentReference: 'FEASTY-CRD-GROUP-1',
    transactionData: groupTransaction,
    expectedTotal: resolveGroupExpectedTotal({ orderCount: 2, pricing: { total: 12800 } }),
  });
});

Deno.test('multi-store: still rejects a charge that is not the group total', () => {
  assertThrowsMessage(
    () =>
      validatePaystackVerificationForOrder({
        order: groupPrimaryOrder,
        paymentReference: 'FEASTY-CRD-GROUP-1',
        transactionData: { ...groupTransaction, amount: 430000 }, // only the primary share
        expectedTotal: resolveGroupExpectedTotal({ orderCount: 2, pricing: { total: 12800 } }),
      }),
    'Amount mismatch: expected 1280000, got 430000'
  );
});

Deno.test('resolveGroupExpectedTotal only overrides for genuine multi-order groups', () => {
  expectEqual(resolveGroupExpectedTotal(null), undefined, 'no group');
  expectEqual(resolveGroupExpectedTotal(undefined), undefined, 'undefined group');
  expectEqual(resolveGroupExpectedTotal({ orderCount: 1, pricing: { total: 2500 } }), undefined, 'single-order group');
  expectEqual(resolveGroupExpectedTotal({ orderCount: null, pricing: { total: 2500 } }), undefined, 'unknown count');
  expectEqual(resolveGroupExpectedTotal({ orderCount: 2, pricing: null }), undefined, 'no group pricing');
  expectEqual(resolveGroupExpectedTotal({ orderCount: 2, pricing: { total: 'abc' } }), undefined, 'garbage total');
  expectEqual(resolveGroupExpectedTotal({ orderCount: 2, pricing: { total: 0 } }), undefined, 'zero total');
  expectEqual(resolveGroupExpectedTotal({ orderCount: 2, pricing: { total: 12800 } }), 12800, 'group total');
  expectEqual(resolveGroupExpectedTotal({ orderCount: 3, pricing: { total: '9000' } }), 9000, 'numeric string total');
});

Deno.test('single-order validation is unchanged when no group total is supplied', () => {
  // expectedTotal undefined (what every single-store order passes) must use order.pricing.total exactly.
  validatePaystackVerificationForOrder({
    order,
    paymentReference: 'FEASTY-CRD-ORDER-1',
    transactionData: { amount: 250000, reference: 'FEASTY-CRD-ORDER-1', status: 'success' },
    expectedTotal: undefined,
  });
  assertThrowsMessage(
    () =>
      validatePaystackVerificationForOrder({
        order,
        paymentReference: 'FEASTY-CRD-ORDER-1',
        transactionData: { amount: 250001, reference: 'FEASTY-CRD-ORDER-1', status: 'success' },
      }),
    'Amount mismatch'
  );
});
