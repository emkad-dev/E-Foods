type JsonObject = Record<string, unknown>;

export type PaymentVerificationOrderSnapshot = {
  id: string;
  payment: JsonObject | null;
  pricing: JsonObject | null;
};

export const normalizeText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : '';

export const toNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

export const toKoboAmount = (amount: unknown) => Math.round(toNumber(amount, 0) * 100);

/**
 * A multi-store checkout is ONE Paystack charge for the whole OrderGroup, but
 * the webhook/queue resolves only the primary order, whose own `pricing.total`
 * is just its restaurant's share. For a genuine multi-order group (orderCount
 * > 1) this returns the group's total so the gateway amount can be checked
 * against what was actually charged. For anything else (no group, a
 * single-order group, or an unusable group total) it returns `undefined`, and
 * the validator keeps using the order's own `pricing.total` exactly as before.
 */
export const resolveGroupExpectedTotal = (
  group: { orderCount?: unknown; pricing?: JsonObject | null } | null | undefined
): number | undefined => {
  if (!group) return undefined;
  if (toNumber(group.orderCount, 0) <= 1) return undefined;
  const groupTotal = toNumber((group.pricing ?? {}).total, 0);
  return groupTotal > 0 ? groupTotal : undefined;
};

export const validatePaystackVerificationForOrder = ({
  order,
  paymentReference,
  transactionData,
  expectedTotal,
}: {
  order: PaymentVerificationOrderSnapshot;
  paymentReference: string;
  transactionData: JsonObject;
  /** Group total for a multi-order group; omit to use `order.pricing.total`. */
  expectedTotal?: number;
}) => {
  const storedReference = normalizeText(order.payment?.reference);
  const requestedReference = normalizeText(paymentReference);
  const verifiedReference = normalizeText(transactionData.reference);
  const verifiedStatus = normalizeText(transactionData.status);
  const expectedAmount = toKoboAmount(expectedTotal === undefined ? order.pricing?.total : expectedTotal);
  const actualAmount = toNumber(transactionData.amount, -1);

  if (!storedReference) {
    throw new Error('Order payment reference is missing');
  }

  if (!requestedReference || requestedReference !== storedReference) {
    throw new Error('Payment reference does not match the order');
  }

  if (!verifiedReference || verifiedReference !== storedReference) {
    throw new Error('Verified Paystack reference does not match the order');
  }

  if (verifiedStatus !== 'success') {
    throw new Error(`Paystack transaction is not successful: ${verifiedStatus || 'unknown'}`);
  }

  if (actualAmount !== expectedAmount) {
    throw new Error(`Amount mismatch: expected ${expectedAmount}, got ${actualAmount}`);
  }
};
