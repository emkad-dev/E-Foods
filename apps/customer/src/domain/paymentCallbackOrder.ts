/**
 * Finding the order a Paystack return belongs to when the callback URL carries
 * no orderId (payments started before the server added it, or any other return
 * that lost it). Paystack always sends back `reference`/`trxref`, and every
 * order the customer can read carries that same reference on `payment`.
 */

type OrderWithPaymentReference = {
  id?: string | null;
  orderGroupId?: string | null;
  payment?: { reference?: string | null } | null;
};

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The orderId query param, only when it is UUID-shaped (every order id is a
 * server-generated UUID). Anything else is ignored, so a mangled or hand-edited
 * URL falls through to the reference lookup instead of a doomed refresh.
 */
export const acceptOrderIdParam = (value: unknown): string => {
  const candidate = clean(value);
  return UUID_PATTERN.test(candidate) ? candidate : '';
};

/**
 * The id of the customer's order paid with `reference`, or '' when none match.
 * A grouped checkout shares one reference across its member orders; the one to
 * open is the primary (its id is the group id), which is also the id checkout
 * itself navigates to.
 */
export const findOrderIdForPaymentReference = (
  orders: readonly OrderWithPaymentReference[] | null | undefined,
  reference: string
): string => {
  const wanted = clean(reference);
  if (!wanted || !orders) {
    return '';
  }

  const matches = orders.filter((order) => clean(order?.payment?.reference) === wanted && clean(order?.id));
  if (matches.length === 0) {
    return '';
  }

  const primary = matches.find((order) => clean(order.orderGroupId) === clean(order.id));
  return clean((primary ?? matches[0]).id);
};

/**
 * What the web payment screen remembers in sessionStorage before the window
 * leaves for Paystack, as a second fallback for a return without orderId.
 * Every storage touch is wrapped: the accessor itself can throw (private mode,
 * blocked site data), and losing the handoff only means falling through to the
 * reference lookup.
 */
export type PaymentHandoff = { orderId: string; reference: string };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const PAYMENT_HANDOFF_STORAGE_KEY = 'feasty.paymentHandoff';

export const getSessionStorage = (): StorageLike | null => {
  try {
    const storage = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
    return storage ?? null;
  } catch {
    return null;
  }
};

export const rememberPaymentHandoff = (storage: StorageLike | null, handoff: PaymentHandoff) => {
  const orderId = clean(handoff.orderId);
  if (!storage || !orderId) {
    return;
  }

  try {
    storage.setItem(PAYMENT_HANDOFF_STORAGE_KEY, JSON.stringify({ orderId, reference: clean(handoff.reference) }));
  } catch {
    // Storage full or blocked: the reference lookup still covers this return.
  }
};

export const forgetPaymentHandoff = (storage: StorageLike | null) => {
  try {
    storage?.removeItem(PAYMENT_HANDOFF_STORAGE_KEY);
  } catch {
    // Nothing to do: a stale handoff is rejected by its reference anyway.
  }
};

/**
 * The remembered orderId for this return, or ''. Used only when the return has
 * a reference and the handoff stored that same reference, so a handoff left
 * over from an earlier checkout (or one stored without a reference) never
 * sends the customer to the wrong order.
 */
export const readPaymentHandoffOrderId = (storage: StorageLike | null, returnedReference: string): string => {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(PAYMENT_HANDOFF_STORAGE_KEY) ?? null;
  } catch {
    return '';
  }

  if (!raw) {
    return '';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return '';
  }

  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const orderId = clean((parsed as Record<string, unknown>).orderId);
  const storedReference = clean((parsed as Record<string, unknown>).reference);
  const returned = clean(returnedReference);

  if (!orderId || !returned || storedReference !== returned) {
    return '';
  }

  return orderId;
};
