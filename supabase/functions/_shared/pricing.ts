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

export const calculateOrderPricing = ({
  config,
  deliveryFee,
  items,
  tip,
}: {
  config: PricingConfig;
  deliveryFee: number;
  items: PricedOrderItem[];
  tip: number;
}) => {
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const restaurantBasis = roundCurrency(items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0));
  const safeDeliveryFee = roundCurrency(Math.max(deliveryFee, 0));
  const safeTip = roundCurrency(Math.max(tip, 0));
  const totalMarkup = roundCurrency(Math.max(subtotal - restaurantBasis, 0));
  const partnerServiceFee = roundCurrency(restaurantBasis * config.partnerServiceRate);
  const restaurantPayable = roundCurrency(Math.max(restaurantBasis - partnerServiceFee, 0));
  const platformFee = roundCurrency(totalMarkup + partnerServiceFee);
  const netSettlement = roundCurrency(restaurantPayable + safeDeliveryFee);
  const total = roundCurrency(subtotal + safeDeliveryFee + safeTip);

  return {
    currency: PRICING_CURRENCY,
    deliveryFee: safeDeliveryFee,
    discount: 0,
    dispatchFee: safeDeliveryFee,
    netSettlement,
    partnerServiceFee,
    platformFee,
    restaurantBasis,
    restaurantPayable,
    serviceFee: 0,
    settlement: {
      basis: 'menu_base_prices',
      dispatchFee: safeDeliveryFee,
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
