// Pricing v2 (embedded markup): all platform money math lives here.
// Customer-facing menu price = restaurant base price × (1 + markupRate) + markupFlat, per unit.
// The restaurant is settled at (1 − partnerServiceRate) of its own-price basis — the rate
// is currently 0, so the restaurant keeps 100% of what it prices and the embedded markup
// is the platform's entire take. There is no customer-visible service fee and no
// restaurant commission.
// Spec: docs/superpowers/specs/2026-07-17-pricing-v2-embedded-markup-design.md

export interface PricingConfig {
  markupRate: number;
  markupFlat: number;
  partnerServiceRate: number;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  markupRate: 0.2,
  markupFlat: 100,
  // 0 by decision: the restaurant keeps 100% of its own prices. The rate stays
  // in the math so a partner charge can be enabled from the DB row later.
  partnerServiceRate: 0,
};

export const PRICING_CURRENCY = 'NGN';

export const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Bounds keep a mistyped admin value (e.g. markupRate 20 instead of 0.2) from
// silently multiplying every menu price; out-of-range configs fall back whole.
export const parsePricingConfig = (raw: unknown): PricingConfig => {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_PRICING_CONFIG;
  }

  const record = raw as Record<string, unknown>;
  const markupRate = Number(record.markupRate);
  const markupFlat = Number(record.markupFlat);
  const partnerServiceRate = Number(record.partnerServiceRate);

  const valid =
    Number.isFinite(markupRate) && markupRate >= 0 && markupRate <= 1 &&
    Number.isFinite(markupFlat) && markupFlat >= 0 && markupFlat <= 10000 &&
    Number.isFinite(partnerServiceRate) && partnerServiceRate >= 0 && partnerServiceRate <= 0.5;

  return valid ? { markupRate, markupFlat, partnerServiceRate } : DEFAULT_PRICING_CONFIG;
};

export const toDisplayPrice = (basePrice: number, config: PricingConfig) => {
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return 0;
  }

  return roundCurrency(basePrice * (1 + config.markupRate) + config.markupFlat);
};

export interface PricedOrderItem {
  basePrice: number;
  price: number;
  quantity: number;
}

export type PromoDiscountType = 'percent' | 'fixed' | 'free_delivery';
export type PromoFundingSource = 'platform' | 'restaurant';

// A discount already RESOLVED upstream (code exists, active, in-window, in
// scope, min-basket met — all in _shared/promoCodes.ts). Everything money —
// how large the discount actually is once clamped, and who absorbs it in the
// settlement split — is decided HERE, in pricing.ts, and nowhere else.
export interface ResolvedDiscount {
  fundingSource: PromoFundingSource;
  type: PromoDiscountType;
  value: number;
}

// The raw discount a code asks for, BEFORE any clamp. Kept separate from the
// clamps below so the intent is legible: percent → % of the marked-up subtotal;
// fixed → a flat naira amount; free_delivery → the delivery fee (or a capped
// portion of it when `value` is set).
const rawDiscountAmount = (discount: ResolvedDiscount, subtotal: number, deliveryFee: number) => {
  if (discount.type === 'percent') {
    return roundCurrency((subtotal * Math.max(discount.value, 0)) / 100);
  }
  if (discount.type === 'fixed') {
    return roundCurrency(Math.max(discount.value, 0));
  }
  // free_delivery: value 0/absent means "waive the whole fee"; a positive value
  // caps the waiver.
  return discount.value > 0 ? roundCurrency(Math.min(discount.value, deliveryFee)) : deliveryFee;
};

export const calculateOrderPricing = ({
  config,
  deliveryFee,
  discount,
  items,
  tip,
}: {
  config: PricingConfig;
  deliveryFee: number;
  // Optional so every existing caller (no promo) keeps its exact behaviour:
  // absent ⇒ discount 0 and the settlement is untouched.
  discount?: ResolvedDiscount | null;
  items: PricedOrderItem[];
  tip: number;
}) => {
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const restaurantBasis = roundCurrency(items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0));
  const safeDeliveryFee = roundCurrency(Math.max(deliveryFee, 0));
  const safeTip = roundCurrency(Math.max(tip, 0));
  const totalMarkup = roundCurrency(Math.max(subtotal - restaurantBasis, 0));
  const partnerServiceFee = roundCurrency(restaurantBasis * config.partnerServiceRate);
  const restaurantPayableBase = roundCurrency(Math.max(restaurantBasis - partnerServiceFee, 0));
  const platformFeeBase = roundCurrency(totalMarkup + partnerServiceFee);

  // ── The discount amount, clamped in two stages ──────────────────────────
  //   1. base cap: a percent/fixed discount NEVER exceeds the subtotal; a
  //      free_delivery discount NEVER exceeds the delivery fee.
  //   2. funder-capacity cap: the funder never goes net-negative. A
  //      platform-funded discount is capped at the platform's take
  //      (markup + partner service fee); a restaurant-funded one at the
  //      restaurant's own payable (or, for free_delivery, at the delivery fee
  //      it nets). The customer-visible discount is the clamped figure, so a
  //      mis-sized code silently shrinks rather than paying money nobody has.
  let discountAmount = 0;
  const fundingSource: PromoFundingSource | null = discount ? discount.fundingSource : null;

  if (discount) {
    const raw = rawDiscountAmount(discount, subtotal, safeDeliveryFee);
    const baseCap = discount.type === 'free_delivery' ? safeDeliveryFee : subtotal;
    const afterBaseCap = Math.min(Math.max(raw, 0), baseCap);

    const funderCapacity =
      discount.fundingSource === 'platform'
        ? platformFeeBase
        : discount.type === 'free_delivery'
          ? safeDeliveryFee
          : restaurantPayableBase;

    discountAmount = roundCurrency(Math.max(Math.min(afterBaseCap, funderCapacity), 0));
  }

  // ── The settlement split by funding source ──────────────────────────────
  let platformFee = platformFeeBase;
  let restaurantPayable = restaurantPayableBase;
  let netSettlement = roundCurrency(restaurantPayableBase + safeDeliveryFee);
  let netDispatchFee = safeDeliveryFee;

  if (discount && discountAmount > 0 && fundingSource === 'platform') {
    // Platform absorbs it: the restaurant is paid in full, the discount comes
    // out of the platform's margin (floored at 0 by the capacity cap above).
    platformFee = roundCurrency(Math.max(platformFeeBase - discountAmount, 0));
  } else if (discount && discountAmount > 0 && fundingSource === 'restaurant') {
    if (discount.type === 'free_delivery') {
      // Comes off the restaurant's dispatch fee; the dish payable is untouched.
      netDispatchFee = roundCurrency(Math.max(safeDeliveryFee - discountAmount, 0));
      netSettlement = roundCurrency(restaurantPayableBase + netDispatchFee);
    } else {
      // Comes off the restaurant's own dish revenue; the platform take is
      // untouched.
      restaurantPayable = roundCurrency(Math.max(restaurantPayableBase - discountAmount, 0));
      netSettlement = roundCurrency(restaurantPayable + safeDeliveryFee);
    }
  }

  // total = subtotal + delivery + tip − discount, floored at 0. The discount is
  // a NEW line — it never alters the markup formula.
  const total = roundCurrency(Math.max(subtotal + safeDeliveryFee + safeTip - discountAmount, 0));

  return {
    currency: PRICING_CURRENCY,
    deliveryFee: safeDeliveryFee,
    discount: discountAmount,
    discountFundingSource: discountAmount > 0 ? fundingSource : null,
    dispatchFee: safeDeliveryFee,
    netSettlement,
    partnerServiceFee,
    platformFee,
    restaurantBasis,
    restaurantPayable,
    serviceFee: 0,
    settlement: {
      basis: 'menu_base_prices',
      discount: discountAmount,
      discountFundingSource: discountAmount > 0 ? fundingSource : null,
      dispatchFee: netDispatchFee,
      markupFlat: config.markupFlat,
      markupRate: config.markupRate,
      netSettlement,
      partnerServiceFee,
      partnerServiceRate: config.partnerServiceRate,
      platformFee,
      restaurantBasis,
      restaurantPayable,
      totalMarkup,
    },
    subtotal,
    tip: safeTip,
    total,
  };
};

// The settlement balance identity every order must satisfy, to the kobo:
//     netSettlement + platformFee + tip === total
// Equivalently: (subtotal + deliveryFee + tip) − discount === the sum of what
// is paid out. Holds for a plain order (discount 0) and for BOTH funding
// sources, because the discount reduces `total` and the funder's own payout
// line by the identical clamped amount. Returns the signed residual (0 when
// balanced) so tests can assert it directly.
export const settlementBalanceResidual = (pricing: {
  netSettlement: number;
  platformFee: number;
  tip: number;
  total: number;
}) => roundCurrency(pricing.netSettlement + pricing.platformFee + pricing.tip - pricing.total);
