/**
 * Stable checkout idempotency keys.
 *
 * The server namespaces whatever the client sends as
 * `${uid}:initialize_customer_payment:${key}`, looks it up before creating
 * anything, and replays the stored response on a hit instead of creating a
 * second order and a second Paystack transaction
 * (supabase/functions/_shared/domains/orders.ts:1817-1826, stored at :2024-2030).
 * That protection only engages if a retry sends the SAME key. The key this
 * replaces was `Date.now()` plus a random suffix, so every call minted a fresh
 * key, every lookup missed, and a double-tap on Pay produced two orders and two
 * charges.
 *
 * Kept in its own module (rather than inline in customerOrderActions.ts) so it
 * is pure and node-testable — customerOrderActions.ts pulls in the Supabase
 * client and analytics and cannot be imported from a node test.
 */

export type CheckoutIdempotencyLocation = {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type CheckoutIdempotencyItem = {
  id: string;
  quantity: number;
  restaurantId: string;
};

export type CheckoutIdempotencyInput = {
  deliveryLocation?: CheckoutIdempotencyLocation | null;
  fulfillmentType: string;
  items: CheckoutIdempotencyItem[];
  paymentMethod: string;
  promoCode?: string | null;
  restaurantId: string;
  scheduledFor?: string | null;
  tipAmount: number;
};

/**
 * How long one checkout attempt stays "the same attempt".
 *
 * Long enough to cover every retry that must not double-charge: a double-tap,
 * a network timeout retried by hand, and a trip out to the Paystack page and
 * back (where replaying the stored response is what we want — it resumes the
 * original pending order rather than opening a second one).
 *
 * Short enough that deliberately ordering the identical basket again later is
 * a genuinely new order: once the window lapses the same basket fingerprint
 * mints a new key, so the customer is not locked out of re-ordering.
 */
export const CHECKOUT_RETRY_WINDOW_MS = 15 * 60 * 1000;

const FINGERPRINT_VERSION = 'v1';

const normalizeAmount = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : '0.00');

const normalizeCoordinate = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(6) : '';

const describeLocation = (location: CheckoutIdempotencyLocation | null | undefined) => {
  if (!location) {
    return '';
  }

  return [
    (location.address ?? '').trim(),
    normalizeCoordinate(location.latitude),
    normalizeCoordinate(location.longitude),
  ].join(',');
};

// Two independent 32-bit hashes, concatenated. The key lands in a primary-key
// column server-side, so it has to stay bounded however large the basket gets;
// a single 32-bit hash is short enough to collide across one customer's own
// baskets, and a collision here would replay a previous order's response
// instead of charging for the new basket.
const fnv1a32 = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const djb2Xor32 = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 33) ^ value.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
};

const toHex32 = (value: number) => value.toString(16).padStart(8, '0');

/**
 * Everything that makes this basket a distinct order, and nothing else.
 *
 * Included: the item set (id + quantity + owning restaurant, sorted so cart
 * ordering is irrelevant), the primary restaurant, fulfillment type, payment
 * method, delivery address and coordinates, tip, promo code and schedule slot.
 *
 * Deliberately excluded:
 * - `attributedPromoId`, because `takeAttributedPromoId()` consumes it — it is
 *   null on the second call, so including it would guarantee the retry missed
 *   the idempotency record, which is the exact defect being fixed.
 * - `deviceSessionId` and the callback URL, which are constant per device/build
 *   and so add nothing.
 * - item prices and names, because the server re-derives price from the
 *   authoritative menu and never trusts the client's copy; including them would
 *   only let a background menu refresh split a retry into a second order.
 */
export const buildCheckoutFingerprint = (input: CheckoutIdempotencyInput): string => {
  const items = input.items
    .map((item) => `${item.restaurantId}:${item.id}:${Math.max(0, Math.trunc(item.quantity))}`)
    .sort();

  const canonical = [
    FINGERPRINT_VERSION,
    input.fulfillmentType,
    input.paymentMethod,
    input.restaurantId,
    normalizeAmount(input.tipAmount),
    (input.promoCode ?? '').trim().toUpperCase(),
    (input.scheduledFor ?? '').trim(),
    describeLocation(input.deliveryLocation),
    String(items.length),
    items.join(','),
  ].join('|');

  return `${toHex32(fnv1a32(canonical))}${toHex32(djb2Xor32(canonical))}`;
};

// One slot is enough: a customer has one checkout in flight at a time.
let liveAttempt: { fingerprint: string; key: string; mintedAtMs: number } | null = null;

/**
 * Returns the key for this checkout attempt: the same string for every retry of
 * an unchanged basket inside the retry window, a new one as soon as the basket
 * differs or the window lapses.
 *
 * Residual limitation: the attempt is held in memory, so a retry that follows
 * a full app reload mints a new key and can still duplicate. That needs
 * persistence (or a server-side dedupe on order content) to close.
 */
export const resolveCheckoutIdempotencyKey = (
  input: CheckoutIdempotencyInput,
  nowMs: number = Date.now()
): string => {
  const fingerprint = buildCheckoutFingerprint(input);

  if (
    liveAttempt &&
    liveAttempt.fingerprint === fingerprint &&
    nowMs - liveAttempt.mintedAtMs >= 0 &&
    nowMs - liveAttempt.mintedAtMs < CHECKOUT_RETRY_WINDOW_MS
  ) {
    return liveAttempt.key;
  }

  const key = `cust-${fingerprint}-${Math.trunc(nowMs).toString(36)}`;
  liveAttempt = { fingerprint, key, mintedAtMs: nowMs };
  return key;
};

/** Test-only: drops the in-flight attempt so cases cannot leak into each other. */
export const resetCheckoutIdempotencyAttempt = () => {
  liveAttempt = null;
};
