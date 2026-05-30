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

export const validatePaystackVerificationForOrder = ({
  order,
  paymentReference,
  transactionData,
}: {
  order: PaymentVerificationOrderSnapshot;
  paymentReference: string;
  transactionData: JsonObject;
}) => {
  const storedReference = normalizeText(order.payment?.reference);
  const requestedReference = normalizeText(paymentReference);
  const verifiedReference = normalizeText(transactionData.reference);
  const verifiedStatus = normalizeText(transactionData.status);
  const expectedAmount = toKoboAmount(order.pricing?.total);
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
