// Per-order 4-digit handoff code. Customer-held, rider-entered proof of delivery.
export const DELIVERY_CODE_MAX_ATTEMPTS = 5;
export const generateDeliveryCode = (): string => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 10000).padStart(4, '0');
};
export const isValidDeliveryCodeFormat = (value: unknown): boolean =>
  typeof value === 'string' && /^\d{4}$/.test(value);
