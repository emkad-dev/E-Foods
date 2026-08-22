// Task 17 (G1): promo-code resolution — the PURE half of the discount engine.
//
// This module decides whether a loaded PromoCode row may apply to a given
// basket (existence, active, validity window, restaurant scope, minimum
// basket) and, if so, produces the ResolvedDiscount that _shared/pricing.ts
// turns into money. It deliberately imports NOTHING that touches the Supabase
// client, so it type-checks and unit-tests in the first (checked) `deno test`
// invocation without any env. The DB reads, the atomic redemption RPC, and the
// release RPC live in the orders/admin domain modules that already hold the
// service client.
//
// The client NEVER computes its own discount: the cart preview and the
// placement path both call this against the server's authoritative row, and
// placement re-validates from scratch — a stale or tampered client cannot make
// a code apply that this module would reject.

import type { PromoDiscountType, PromoFundingSource, ResolvedDiscount } from './pricing.ts';

export const PROMO_CODE_COLUMNS =
  'id,code,type,value,minBasket,perUserCap,globalCap,startsAt,endsAt,restaurantId,fundingSource,isActive,isAutomatic';

export interface PromoCodeRow {
  code: string;
  endsAt: string | null;
  fundingSource: string;
  globalCap: number | null;
  id: string;
  isActive: boolean;
  isAutomatic: boolean;
  minBasket: number | null;
  perUserCap: number | null;
  restaurantId: string | null;
  startsAt: string | null;
  type: string;
  value: number | null;
}

export type PromoRejectionReason =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'wrong_restaurant'
  | 'min_basket'
  | 'malformed';

export type PromoValidationResult =
  | { ok: true; discount: ResolvedDiscount; minBasket: number }
  | { ok: false; reason: PromoRejectionReason; minBasket?: number };

// Codes are matched case-insensitively; the DB stores them upper-cased, so the
// lookup normalizes the same way.
export const normalizePromoCode = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().toUpperCase() : '';

const toFundingSource = (raw: string): PromoFundingSource | null =>
  raw === 'platform' || raw === 'restaurant' ? raw : null;

const toDiscountType = (raw: string): PromoDiscountType | null =>
  raw === 'percent' || raw === 'fixed' || raw === 'free_delivery' ? raw : null;

const parseMillis = (iso: string | null): number | null => {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Pure eligibility check for an already-loaded code against a basket. Does NOT
 * check usage caps — those are enforced atomically at redemption in SQL
 * (ebuy_redeem_promo_code), because a count-then-decide here would be exactly
 * the read-then-write race the migration header rejects. Returns the
 * ResolvedDiscount (type/value/fundingSource) for pricing.ts to clamp into an
 * amount; returns a structured refusal reason otherwise.
 */
export const validatePromoCodeForBasket = ({
  promoCode,
  restaurantId,
  restaurantBasis,
  now,
}: {
  now: Date;
  promoCode: PromoCodeRow | null;
  restaurantBasis: number;
  restaurantId: string;
}): PromoValidationResult => {
  if (!promoCode) {
    return { ok: false, reason: 'not_found' };
  }

  if (promoCode.isActive !== true) {
    return { ok: false, reason: 'inactive' };
  }

  const type = toDiscountType(promoCode.type);
  const fundingSource = toFundingSource(promoCode.fundingSource);
  if (!type || !fundingSource) {
    return { ok: false, reason: 'malformed' };
  }

  const nowMs = now.getTime();
  const startsMs = parseMillis(promoCode.startsAt);
  const endsMs = parseMillis(promoCode.endsAt);

  if (startsMs !== null && nowMs < startsMs) {
    return { ok: false, reason: 'not_started' };
  }
  if (endsMs !== null && nowMs > endsMs) {
    return { ok: false, reason: 'expired' };
  }

  // Platform-wide (restaurantId null) applies everywhere; a scoped code only to
  // its own restaurant's order.
  if (promoCode.restaurantId && promoCode.restaurantId !== restaurantId) {
    return { ok: false, reason: 'wrong_restaurant' };
  }

  // Minimum basket runs on the restaurant BASE basis — the restaurant's own
  // menu prices — exactly as min-order does, never on the marked-up subtotal.
  const minBasket = Number.isFinite(promoCode.minBasket) ? Number(promoCode.minBasket) : 0;
  if (restaurantBasis < minBasket) {
    return { ok: false, reason: 'min_basket', minBasket };
  }

  return {
    ok: true,
    minBasket,
    discount: {
      fundingSource,
      type,
      value: Number.isFinite(promoCode.value) ? Number(promoCode.value) : 0,
    },
  };
};

// Client-safe messages. Not-found / inactive / window / scope all collapse to
// ONE generic message so a probing client cannot distinguish "no such code"
// from "expired" or "wrong restaurant" and enumerate the code space. Only the
// minimum-basket refusal is specific, because it is actionable and leaks
// nothing sensitive.
export const promoRejectionMessage = (result: { reason: PromoRejectionReason; minBasket?: number }): string => {
  if (result.reason === 'min_basket') {
    const min = result.minBasket ?? 0;
    return `Your basket doesn't meet this code's minimum of ${min.toFixed(2)}.`;
  }
  return 'This promo code is not valid.';
};

// Maps the atomic-redemption RPC's structured reason to a client-safe message.
// Cap-reached is distinguishable from invalid because it is not an enumeration
// signal (the code plainly exists and was valid at preview) and "no longer
// available" is the honest thing to tell the customer.
export const promoRedemptionMessage = (reason: string): string => {
  switch (reason) {
    case 'global_cap_reached':
    case 'user_cap_reached':
      return 'This promo code has reached its usage limit.';
    case 'already_redeemed':
      return 'This promo code was already applied to this order.';
    default:
      return 'This promo code is no longer available.';
  }
};
