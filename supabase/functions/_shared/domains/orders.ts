// Orders domain: the customer's own order lifecycle — browsing favourites,
// placing an order, paying for it, cancelling it, and the customer side of the
// support thread.
//
// The two security invariants that live here and must not move: the
// restaurant's own menu price is re-derived server-side and never accepted from
// the client, and the delivery-radius check runs here rather than trusting the
// app to have done it.

import { isMenuItemAvailable, isStorePaused } from '../availability.ts';
import { serviceClient } from '../client.ts';
import { computeEtaRange, haversineKm } from '../deliveryEta.ts';
import { isDeliveryOutOfRange } from '../deliveryCoverage.ts';
import { loadDispatchRiderSnapshot } from '../dispatchRiders.ts';
import { releaseDispatchAssignmentLoad } from '../dispatchSelection.ts';
import { loadRestaurantPrepTimeEstimate, loadRestaurantTimingContext } from '../prepTime.ts';
import {
  buildTransactionalEmailHtml,
  formatNairaAmount,
  sendTransactionalEmail,
  shortOrderCode,
} from '../email.ts';
import { buildNotificationData, notifyRestaurantUsers, notifySafely, notifyUsers } from '../notifications.ts';
import { logEdgeEvent } from '../observability.ts';
import {
  captureOrderPlacementRiskSignals,
  capturePaymentVerificationRiskSignals,
  captureRefundAbuseSignals,
} from '../riskSignals.ts';
import {
  CUSTOMER_ORDER_COLUMNS,
  DEFAULT_CURRENCY,
  insertDeliveryEvent,
  loadOrderBundle,
  loadOrderRelations,
  ORDER_GROUP_COLUMNS,
  maybeExpireUnpaidOrder,
  normalizeOrderStatus,
  ORDER_STATUS,
  PAYMENT_PROVIDER_CASH,
  PAYMENT_PROVIDER_PAYSTACK,
  PAYMENT_STATUS,
  PAYSTACK_PAYMENT_METHODS,
  PREPAID_PAYMENT_METHODS,
  releasePromoRedemption,
  toOrderSnapshotResponse,
  updateOrderRecord,
  upsertPaymentTransaction,
  type CustomerOrderRow,
  type OrderGroupRow,
  type PaymentTransactionRow,
} from '../orders.ts';
import {
  assertPaystackConfigured,
  buildPaystackReference,
  fromKoboAmount,
  getNormalizedPaystackCallbackUrl,
  getPaystackPublicKey,
  initializePaystackTransaction,
  toKoboAmount,
  verifyPaystackTransaction,
} from '../paystack.ts';
import { loadDispatchTrackingConfig, loadPricingConfig } from '../platformSettings.ts';
import {
  validateScheduledSlot,
  scheduledSlotRejectionMessage,
  type RestaurantHoursRow,
} from '../scheduledOrders.ts';
import { calculateOrderPricing, toDisplayPrice, type PricingConfig, type ResolvedDiscount } from '../pricing.ts';
import {
  PROMO_CODE_COLUMNS,
  normalizePromoCode,
  promoRedemptionMessage,
  promoRejectionMessage,
  validatePromoCodeForBasket,
  type PromoCodeRow,
  type PromoRejectionReason,
} from '../promoCodes.ts';
import { broadcastOrderChanged, broadcastSupportInboxChanged, broadcastSupportThreadChanged } from '../realtime.ts';
import { resolveModifierSelections } from '../itemModifiers.ts';
import { loadRestaurantById, type RestaurantRecordRow } from '../restaurants.ts';
import { ORDER_ACTIONS } from '../rpc/actions.ts';
import type { JsonObject } from '../rpc/coercion.ts';
import {
  nowIso,
  parseInteger,
  parseNumber,
  roundCurrency,
  sanitizeOptionalText,
  sanitizeText,
} from '../rpc/coercion.ts';
import { ensureRole, type AuthenticatedRequestContext } from '../rpc/context.ts';
import { defineRpcDomain, type RpcHandler } from '../rpc/registry.ts';
import { fail, json } from '../rpc/respond.ts';
import { appendSupportMessage, type SupportConversationRow, type SupportMessageRow } from '../support.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

type IdempotencyRecordRow = {
  actorUid?: string | null;
  key: string;
  response?: JsonObject | null;
  scope: string;
};

// Local to this domain on purpose: _shared/idempotency.ts wraps the same table
// but rewrites the Postgrest error text, and these messages reach the client.
const getIdempotencyRecord = async (key: string) => {
  const { data, error } = await serviceClient
    .from('IdempotencyRecord')
    .select('key,scope,actorUid,response')
    .eq('key', key)
    .maybeSingle<IdempotencyRecordRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

const storeIdempotencyRecord = async (
  key: string,
  scope: string,
  actorUid: string,
  response: JsonObject | null
) => {
  const { error } = await serviceClient.from('IdempotencyRecord').upsert(
    {
      key,
      scope,
      actorUid,
      response,
      updatedAt: nowIso(),
    },
    { onConflict: 'key' }
  );

  if (error) {
    throw new Error(error.message);
  }
};

const loadOrdersForCustomer = async (customerId: string) => {
  const { data: orders, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq('customerId', customerId)
    .order('createdAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const orderList = await Promise.all(((orders ?? []) as CustomerOrderRow[]).map((order) => maybeExpireUnpaidOrder(order)));
  const { assignmentsByOrderId, itemsByOrderId } = await loadOrderRelations(orderList.map((order) => order.id));

  return orderList.map((order) =>
    toOrderSnapshotResponse(
      order,
      itemsByOrderId.get(order.id) ?? [],
      assignmentsByOrderId.get(order.id) ?? null
    )
  );
};

const loadFavoriteRestaurantIds = async (customerId: string) => {
  const { data, error } = await serviceClient
    .from('CustomerFavoriteRestaurant')
    .select('restaurantId,createdAt')
    .eq('customerId', customerId)
    .order('createdAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as { restaurantId: string }[]).map((favorite) => favorite.restaurantId);
};

const flattenRestaurantMenu = (restaurant: RestaurantRecordRow) => {
  const categories = Array.isArray(restaurant.menu) ? restaurant.menu : [];
  return categories.flatMap((category) => {
    const items = Array.isArray((category as JsonObject)?.items) ? ((category as JsonObject).items as unknown[]) : [];

    return items
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const itemRecord = item as JsonObject;
        return {
          id: sanitizeText(itemRecord.id),
          // Raw passthrough (not pre-coerced to a plain boolean): isMenuItemAvailable
          // below is what interprets isAvailable together with unavailableUntil, and it
          // needs the real unavailableUntil value alongside it, not a derived boolean.
          isAvailable: itemRecord.isAvailable,
          modifierGroups: Array.isArray(itemRecord.modifierGroups) ? itemRecord.modifierGroups : [],
          name: sanitizeText(itemRecord.name),
          price: parseNumber(itemRecord.price, Number.NaN),
          unavailableUntil: itemRecord.unavailableUntil,
        };
      })
      .filter((item) => item.id && item.name && Number.isFinite(item.price));
  });
};

const buildOrderItems = (
  requestedItems: unknown,
  restaurantId: string,
  restaurant: RestaurantRecordRow,
  pricingConfig: PricingConfig,
  now: Date
) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    fail(400, 'Add at least one item before placing an order.');
  }

  const menuItems = flattenRestaurantMenu(restaurant);
  const menuLookup = new Map(menuItems.map((item) => [item.id, item]));

  return requestedItems.map((item) => {
    const itemRecord = item as JsonObject;
    const itemId = sanitizeText(itemRecord.id);
    const quantity = Number.parseInt(String(itemRecord.quantity ?? ''), 10);

    if (!itemId || !Number.isInteger(quantity) || quantity <= 0) {
      fail(400, 'Each order item must include a valid id and quantity.');
    }

    const menuItem = menuLookup.get(itemId);
    if (!menuItem) {
      fail(412, 'One or more selected menu items are unavailable.');
    }

    // The named 412: a stale or tampered client must not be able to place an
    // unavailable item, and the rejection names it so the customer knows
    // which line to remove. Shares isMenuItemAvailable with
    // public-catalog/catalog.ts's hasAvailableMenuItem (the list filter) —
    // see availability.test.ts / catalog.test.ts's drift test — so an item
    // hidden from discovery is guaranteed to be rejected here too, and one
    // only timed-unavailable in the past (auto-resumed) is accepted here too.
    if (!isMenuItemAvailable(menuItem, now)) {
      fail(412, `"${menuItem.name}" is currently unavailable. Please remove it and try again.`);
    }

    // Restaurant's own price — settlement and min-order run on this.
    const modifierResolution = resolveModifierSelections({
      groups: menuItem.modifierGroups,
      selectedOptions: itemRecord.selectedOptions,
    });
    if (!modifierResolution.ok) {
      fail(412, modifierResolution.reason);
    }

    const basePrice = roundCurrency(menuItem.price + modifierResolution.optionDelta);

    return {
      basePrice,
      id: menuItem.id,
      name: menuItem.name,
      // Customer-facing price with the platform markup embedded, re-derived
      // server-side from the authoritative menu price (never client input).
      price: toDisplayPrice(basePrice, pricingConfig),
      optionDelta: modifierResolution.optionDelta,
      quantity,
      restaurantId,
      restaurantName: sanitizeText(restaurant.name, 'Restaurant'),
      selectedOptions: modifierResolution.selectedOptions,
    };
  });
};

type PreparedRestaurantOrderDraft = {
  items: Array<{
    basePrice: number;
    id: string;
    name: string;
    optionDelta?: number | null;
    price: number;
    quantity: number;
    restaurantId: string;
    restaurantName: string;
    selectedOptions?: JsonObject[] | null;
  }>;
  orderId: string;
  pricing: JsonObject;
  restaurant: RestaurantRecordRow;
  restaurantId: string;
  restaurantName: string;
  tipAmount: number;
};

const sumCurrency = (values: number[]) => roundCurrency(values.reduce((sum, value) => sum + value, 0));

const aggregateOrderGroupPricing = (orders: PreparedRestaurantOrderDraft[]) => {
  const template = (orders[0]?.pricing ?? {}) as JsonObject;
  const settlementTemplate = (template.settlement ?? {}) as JsonObject;
  const subtotal = sumCurrency(orders.map((order) => parseNumber(order.pricing.subtotal, 0)));
  const deliveryFee = sumCurrency(orders.map((order) => parseNumber(order.pricing.deliveryFee, 0)));
  const serviceFee = sumCurrency(orders.map((order) => parseNumber(order.pricing.serviceFee, 0)));
  const tip = sumCurrency(orders.map((order) => parseNumber(order.pricing.tip, 0)));
  const discount = sumCurrency(orders.map((order) => parseNumber(order.pricing.discount, 0)));
  const total = sumCurrency(orders.map((order) => parseNumber(order.pricing.total, 0)));
  const restaurantBasis = sumCurrency(orders.map((order) => parseNumber(order.pricing.restaurantBasis, 0)));
  const partnerServiceFee = sumCurrency(orders.map((order) => parseNumber(order.pricing.partnerServiceFee, 0)));
  const restaurantPayable = sumCurrency(orders.map((order) => parseNumber(order.pricing.restaurantPayable, 0)));
  const platformFee = sumCurrency(
    orders.map((order) => parseNumber(((order.pricing.settlement ?? {}) as JsonObject).platformFee, 0))
  );
  const netSettlement = sumCurrency(
    orders.map((order) => parseNumber(((order.pricing.settlement ?? {}) as JsonObject).netSettlement, 0))
  );
  const totalMarkup = sumCurrency(
    orders.map((order) => parseNumber(((order.pricing.settlement ?? {}) as JsonObject).totalMarkup, 0))
  );
  const dispatchFee = sumCurrency(
    orders.map((order) => parseNumber(((order.pricing.settlement ?? {}) as JsonObject).dispatchFee, 0))
  );

  return {
    currency: template.currency ?? DEFAULT_CURRENCY,
    deliveryFee,
    discount,
    discountFundingSource: discount > 0 ? null : null,
    dispatchFee,
    netSettlement,
    partnerServiceFee,
    platformFee,
    restaurantBasis,
    restaurantPayable,
    serviceFee,
    settlement: {
      basis: 'menu_base_prices',
      discount,
      discountFundingSource: discount > 0 ? null : null,
      dispatchFee,
      markupFlat: parseNumber(settlementTemplate.markupFlat, 0),
      markupRate: parseNumber(settlementTemplate.markupRate, 0),
      netSettlement,
      partnerServiceFee,
      partnerServiceRate: parseNumber(settlementTemplate.partnerServiceRate, 0),
      platformFee,
      restaurantBasis,
      restaurantPayable,
      totalMarkup,
    },
    subtotal,
    tip,
    total,
  };
};

const normalizeDeliveryLocation = (deliveryLocation: unknown) => {
  if (!deliveryLocation || typeof deliveryLocation !== 'object') {
    return null;
  }

  const record = deliveryLocation as JsonObject;
  const address = sanitizeText(record.address);
  const latitude = parseNumber(record.latitude, Number.NaN);
  const longitude = parseNumber(record.longitude, Number.NaN);

  if (!address) {
    return null;
  }

  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    address,
    label: sanitizeOptionalText(record.label),
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    note: sanitizeOptionalText(record.note),
    shortAddress: sanitizeOptionalText(record.shortAddress),
  };
};

const buildInitialPaymentSummary = ({
  paymentMethod,
  reference = null,
  authorizationUrl = null,
  accessCode = null,
  deviceSessionId = null,
  settlementMode = 'manual',
  splitSubaccountCode = null,
  settlement = null,
}: {
  accessCode?: string | null;
  authorizationUrl?: string | null;
  deviceSessionId?: string | null;
  paymentMethod: string;
  reference?: string | null;
  settlementMode?: string | null;
  splitSubaccountCode?: string | null;
  settlement?: JsonObject | null;
}) => {
  if (!PREPAID_PAYMENT_METHODS.has(paymentMethod)) {
    return {
      capturedAmount: 0,
      deviceSessionId: sanitizeOptionalText(deviceSessionId),
      lastEvent: 'awaiting_cash_collection',
      method: paymentMethod,
      processor: PAYMENT_PROVIDER_CASH,
      reference: null,
      refundAmount: 0,
      refundedAt: null,
      paidAt: null,
      settlementMode: sanitizeText(settlementMode, 'manual'),
      settlement,
      splitSubaccountCode: sanitizeOptionalText(splitSubaccountCode),
      status: PAYMENT_STATUS.PENDING,
    };
  }

  return {
    accessCode,
    authorizationUrl,
    capturedAmount: 0,
    channel: paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'card',
    deviceSessionId: sanitizeOptionalText(deviceSessionId),
    lastEvent: 'awaiting_customer_payment',
    method: paymentMethod,
    paidAt: null,
    processor: PAYMENT_PROVIDER_PAYSTACK,
    reference,
    refundAmount: 0,
    refundedAt: null,
    settlementMode: sanitizeText(settlementMode, 'manual'),
    settlement,
    splitSubaccountCode: sanitizeOptionalText(splitSubaccountCode),
    status: PAYMENT_STATUS.PENDING,
    verifiedAt: null,
  };
};

export type PaymentSettlementSummary = {
  settlementMode: 'manual' | 'split';
  splitSubaccountCode: string | null;
};

export const resolvePaymentSettlementSummary = (
  restaurant: Pick<RestaurantRecordRow, 'paystackSubaccountCode'>,
  allowSplit = true
): PaymentSettlementSummary => {
  const splitSubaccountCode = sanitizeOptionalText(restaurant.paystackSubaccountCode);
  const settlementMode = allowSplit && splitSubaccountCode ? 'split' : 'manual';

  return {
    settlementMode,
    splitSubaccountCode: settlementMode === 'split' ? splitSubaccountCode : null,
  };
};

// ── Promo-code data access (service-role only; see promoCodes.ts for the
//    pure eligibility logic and 20260821_promo_codes.sql for the atomic caps) ──

const loadPromoCodeByCode = async (code: string): Promise<PromoCodeRow | null> => {
  const { data, error } = await serviceClient
    .from('PromoCode')
    .select(PROMO_CODE_COLUMNS)
    .eq('code', code)
    .maybeSingle<PromoCodeRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

const loadAutomaticPromoCodes = async (restaurantId: string): Promise<PromoCodeRow[]> => {
  const { data, error } = await serviceClient
    .from('PromoCode')
    .select(PROMO_CODE_COLUMNS)
    .eq('isAutomatic', true)
    .eq('isActive', true)
    // Platform-wide (restaurantId null) or scoped to THIS restaurant.
    .or(`restaurantId.is.null,restaurantId.eq.${restaurantId}`)
    .returns<PromoCodeRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
};

const redeemPromoCode = async ({
  promoCodeId,
  userId,
  orderId,
  discountAmount,
}: {
  discountAmount: number;
  orderId: string;
  promoCodeId: string;
  userId: string;
}): Promise<{ reason: string; redeemed: boolean }> => {
  const { data, error } = await serviceClient.rpc('ebuy_redeem_promo_code', {
    p_promo_code_id: promoCodeId,
    p_user_id: userId,
    p_order_id: orderId,
    p_discount_amount: discountAmount,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = (Array.isArray(data) ? data[0] : data) as { reason?: string; redeemed?: boolean } | undefined;
  return { reason: sanitizeText(row?.reason, 'unavailable'), redeemed: row?.redeemed === true };
};

type ResolvedBasketPromo = { code: string; discount: ResolvedDiscount; promoCodeId: string };

// Redeems the resolved promo ATOMICALLY (usage caps enforced in SQL) once the
// order id exists but BEFORE the order row is written. A cap-busted redemption
// is a hard 409, so an order is never created with a discount whose cap was
// already exhausted. A no-op when nothing applies.
const redeemResolvedPromoOrFail = async (
  resolvedPromo: ResolvedBasketPromo | null | undefined,
  userId: string,
  orderId: string,
  discountAmount: number
) => {
  if (!resolvedPromo || discountAmount <= 0) {
    return;
  }
  const outcome = await redeemPromoCode({
    promoCodeId: resolvedPromo.promoCodeId,
    userId,
    orderId,
    discountAmount,
  });
  if (!outcome.redeemed) {
    fail(409, promoRedemptionMessage(outcome.reason));
  }
};

// Resolves which discount applies to a basket, WITHOUT enforcing usage caps
// (those are atomic at redemption). A manually-entered code wins if present and
// valid; otherwise the best-value eligible AUTOMATIC offer applies (a code with
// isAutomatic=true auto-applies when the basket qualifies and the customer
// typed nothing). Returns the resolved promo, a structured rejection for a bad
// manual code, or null when nothing applies.
const resolveBasketPromo = async ({
  config,
  deliveryFee,
  items,
  now,
  rawCode,
  restaurantBasis,
  restaurantId,
  tip,
}: {
  config: PricingConfig;
  deliveryFee: number;
  items: Array<{ basePrice: number; price: number; quantity: number }>;
  now: Date;
  rawCode: unknown;
  restaurantBasis: number;
  restaurantId: string;
  tip: number;
}): Promise<
  { rejected: { minBasket?: number; reason: PromoRejectionReason } } | { resolved: ResolvedBasketPromo | null }
> => {
  const code = normalizePromoCode(rawCode);

  // Amount a candidate discount actually yields once pricing.ts clamps it —
  // used to (a) drop 0-value candidates and (b) rank automatic offers.
  const discountAmountFor = (discount: ResolvedDiscount) =>
    calculateOrderPricing({ config, deliveryFee, discount, items, tip }).discount;

  if (code) {
    const promoCode = await loadPromoCodeByCode(code);
    const result = validatePromoCodeForBasket({ promoCode, restaurantId, restaurantBasis, now });
    if (!result.ok) {
      return { rejected: { minBasket: result.minBasket, reason: result.reason } };
    }
    // A valid code that clamps to a 0 discount for this basket is treated as
    // "nothing to apply" rather than a redemption consuming a cap slot for free.
    if (discountAmountFor(result.discount) <= 0) {
      return { resolved: null };
    }
    return { resolved: { code: promoCode!.code, discount: result.discount, promoCodeId: promoCode!.id } };
  }

  const automatic = await loadAutomaticPromoCodes(restaurantId);
  let best: ResolvedBasketPromo | null = null;
  let bestAmount = 0;
  for (const promoCode of automatic) {
    const result = validatePromoCodeForBasket({ promoCode, restaurantId, restaurantBasis, now });
    if (!result.ok) {
      continue;
    }
    const amount = discountAmountFor(result.discount);
    if (amount > bestAmount) {
      bestAmount = amount;
      best = { code: promoCode.code, discount: result.discount, promoCodeId: promoCode.id };
    }
  }

  return { resolved: best };
};

// Service-role read of a restaurant's 7 per-day trading-hours rows (Task 18 /
// G2). RestaurantHours is RLS-on / no-policies (service-role only), so this is
// the only read path. Slot validation runs against these rows in
// restaurant-local time.
const loadRestaurantHours = async (restaurantId: string): Promise<RestaurantHoursRow[]> => {
  const { data, error } = await serviceClient
    .from('RestaurantHours')
    .select('dayOfWeek,isClosed,opensAt,closesAt')
    .eq('restaurantId', restaurantId)
    .returns<RestaurantHoursRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
};

const groupRequestedItemsByRestaurant = (requestedItems: unknown, fallbackRestaurantId: string) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    fail(400, 'Add at least one item before placing an order.');
  }

  const grouped = new Map<string, { items: unknown[]; restaurantId: string; restaurantName: string }>();

  for (const requestedItem of requestedItems) {
    const itemRecord = requestedItem as JsonObject;
    const restaurantId = sanitizeText(itemRecord.restaurantId, fallbackRestaurantId);
    if (!restaurantId) {
      fail(400, 'Each order item must include a restaurant id.');
    }

    const restaurantName = sanitizeText(itemRecord.restaurantName, 'Restaurant');
    const bucket = grouped.get(restaurantId) ?? { items: [], restaurantId, restaurantName };
    bucket.items.push(requestedItem);
    if (restaurantName) {
      bucket.restaurantName = restaurantName;
    }
    grouped.set(restaurantId, bucket);
  }

  return [...grouped.values()];
};

const prepareCustomerOrderDraft = async (
  requestData: Record<string, unknown>,
  allowedPaymentMethods: readonly string[] 
) => {
  const fallbackRestaurantId = sanitizeText(requestData.restaurantId);
  const fulfillmentType = sanitizeText(requestData.fulfillmentType, 'delivery');
  const paymentMethod = sanitizeText(requestData.paymentMethod, 'card');
  const idempotencyKey = sanitizeText(requestData.idempotencyKey);
  const tipAmount = roundCurrency(parseNumber(requestData.tipAmount, 0));
  const deviceSessionId = sanitizeText(requestData.deviceSessionId);

  if (!fallbackRestaurantId) {
    fail(400, 'A restaurant is required to place an order.');
  }

  if (!['delivery', 'pickup'].includes(fulfillmentType)) {
    fail(400, 'Unsupported fulfillment type.');
  }

  if (!['cash', 'card', 'bank_transfer', 'wallet'].includes(paymentMethod)) {
    fail(400, 'Unsupported payment method.');
  }

  if (!allowedPaymentMethods.includes(paymentMethod)) {
    if (paymentMethod === 'wallet') {
      fail(412, 'Wallet payments are still coming soon. Use card, bank transfer, or cash for now.');
    }

    fail(412, 'This checkout flow does not support the selected payment method.');
  }

  if (tipAmount < 0 || tipAmount > 200) {
    fail(400, 'Tip amount is outside the allowed range.');
  }

  const restaurantId = fallbackRestaurantId;
  const groupedRequests = groupRequestedItemsByRestaurant(requestData.items, fallbackRestaurantId);
  const isMultiStore = groupedRequests.length > 1;
  const multiStoreNow = new Date();

  if (isMultiStore) {
    if (normalizePromoCode(requestData.promoCode)) {
      fail(412, 'Promo codes are not yet supported for multi-store checkouts.');
    }

    const pricingConfig = await loadPricingConfig();
    const multiStoreLocation =
      fulfillmentType === 'delivery' ? normalizeDeliveryLocation(requestData.deliveryLocation) : null;
    if (fulfillmentType === 'delivery' && !multiStoreLocation) {
      fail(400, 'A valid delivery location is required.');
    }

    const restaurantDrafts: PreparedRestaurantOrderDraft[] = [];
    let primaryRestaurant: RestaurantRecordRow | null = null;

    for (const [index, groupedRequest] of groupedRequests.entries()) {
      const { restaurant, approval } = await loadRestaurantById(groupedRequest.restaurantId);
      if (!restaurant) {
        fail(404, 'The selected restaurant no longer exists.');
      }

      if (restaurant.isPublished === false || restaurant.isOpen === false) {
        fail(412, 'This restaurant is not accepting orders right now.');
      }

      if (sanitizeOptionalText(approval?.status) && sanitizeText(approval?.status) !== 'approved') {
        fail(412, 'This restaurant is not accepting orders right now.');
      }

      if (isStorePaused(restaurant, multiStoreNow)) {
        fail(412, 'This restaurant is paused right now. Please check back soon.');
      }

      if (fulfillmentType === 'delivery' && restaurant.supportsDelivery === false) {
        fail(412, 'This restaurant does not support delivery.');
      }

      if (fulfillmentType === 'pickup' && restaurant.supportsPickup === false) {
        fail(412, 'This restaurant does not support pickup.');
      }

      const items = buildOrderItems(groupedRequest.items, groupedRequest.restaurantId, restaurant, pricingConfig, multiStoreNow);
      const restaurantBasis = items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0);
      const minOrder = parseNumber(restaurant.minOrder, 0);
      if (restaurantBasis < minOrder) {
        fail(412, `This restaurant requires a minimum order of ${minOrder.toFixed(2)}.`);
      }

      if (fulfillmentType === 'delivery') {
        if (
          isDeliveryOutOfRange({
            restaurantLatitude: restaurant.latitude,
            restaurantLongitude: restaurant.longitude,
            deliveryLatitude: multiStoreLocation?.latitude,
            deliveryLongitude: multiStoreLocation?.longitude,
            deliveryRadiusKm: restaurant.deliveryRadiusKm,
          })
        ) {
          fail(412, 'This restaurant does not deliver to your selected location yet.');
        }
      }

      const tipShare = index === 0 ? tipAmount : 0;
      const deliveryFee = fulfillmentType === 'delivery' ? parseNumber(restaurant.deliveryFee, 0) : 0;
      const pricing = calculateOrderPricing({
        config: pricingConfig,
        deliveryFee,
        items,
        tip: tipShare,
      });

      if (!primaryRestaurant) {
        primaryRestaurant = restaurant;
      }

      restaurantDrafts.push({
        items,
        orderId: crypto.randomUUID(),
        pricing,
        restaurant,
        restaurantId: groupedRequest.restaurantId,
        restaurantName: sanitizeText(restaurant.name, 'Restaurant'),
        tipAmount: tipShare,
      });
    }

    return {
      deliveryLocation: multiStoreLocation,
      fulfillmentType,
      idempotencyKey,
      orderId: restaurantDrafts[0]?.orderId ?? crypto.randomUUID(),
      orders: restaurantDrafts,
      paymentMethod,
      pricing: aggregateOrderGroupPricing(restaurantDrafts),
      primaryRestaurant,
      primaryRestaurantId: restaurantDrafts[0]?.restaurantId ?? fallbackRestaurantId,
      restaurant: primaryRestaurant,
      restaurantId: restaurantDrafts[0]?.restaurantId ?? fallbackRestaurantId,
      resolvedPromo: null,
      scheduledFor: null,
      multiStore: true,
    };
  }

  const { restaurant, approval } = await loadRestaurantById(restaurantId);
  if (!restaurant) {
    fail(404, 'The selected restaurant no longer exists.');
  }

  if (restaurant.isPublished === false || restaurant.isOpen === false) {
    fail(412, 'This restaurant is not accepting orders right now.');
  }

  if (sanitizeOptionalText(approval?.status) && sanitizeText(approval?.status) !== 'approved') {
    fail(412, 'This restaurant is not accepting orders right now.');
  }

  // Task 16 (F2): a stale or tampered client must not be able to order from a
  // paused store — enforced here regardless of what the client last saw.
  // Shares isStorePaused with public-catalog/catalog.ts's
  // isRestaurantRowPaused (the list filter), so a store excluded from
  // discovery is guaranteed to be rejected here too, and one whose pause has
  // expired (auto-resumed) is accepted here too.
  const now = new Date();
  if (isStorePaused(restaurant, now)) {
    fail(412, 'This restaurant is paused right now. Please check back soon.');
  }

  if (fulfillmentType === 'delivery' && restaurant.supportsDelivery === false) {
    fail(412, 'This restaurant does not support delivery.');
  }

  if (fulfillmentType === 'pickup' && restaurant.supportsPickup === false) {
    fail(412, 'This restaurant does not support pickup.');
  }

  const pricingConfig = await loadPricingConfig();
  const items = buildOrderItems(requestData.items, restaurantId, restaurant, pricingConfig, now);
  // Min-order and settlement both run on the restaurant's own menu prices,
  // never on the marked-up customer prices.
  const restaurantBasis = items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0);
  const deliveryFee = fulfillmentType === 'delivery' ? parseNumber(restaurant.deliveryFee, 0) : 0;
  const minOrder = parseNumber(restaurant.minOrder, 0);

  if (restaurantBasis < minOrder) {
    fail(412, `This restaurant requires a minimum order of ${minOrder.toFixed(2)}.`);
  }

  const deliveryLocation =
    fulfillmentType === 'delivery' ? normalizeDeliveryLocation(requestData.deliveryLocation) : null;
  if (fulfillmentType === 'delivery' && !deliveryLocation) {
    fail(400, 'A valid delivery location is required.');
  }

  // Delivery range is enforced here, not in the client alone: a stale or tampered client
  // must not be able to book a delivery the restaurant cannot reach.
  if (
    fulfillmentType === 'delivery' &&
    isDeliveryOutOfRange({
      restaurantLatitude: restaurant.latitude,
      restaurantLongitude: restaurant.longitude,
      deliveryLatitude: deliveryLocation?.latitude,
      deliveryLongitude: deliveryLocation?.longitude,
      deliveryRadiusKm: restaurant.deliveryRadiusKm,
    })
  ) {
    fail(412, 'This restaurant does not deliver to your selected location yet.');
  }

  // Promo resolution is server-side and stale-client-proof: the client's
  // computed discount is never trusted — we re-load the code, re-check the
  // window/scope/min-basket here, and re-derive the discount in pricing.ts. A
  // bad manual code is a hard 412; caps are NOT checked here (they are enforced
  // atomically at redemption in the handler).
  const promoResolution = await resolveBasketPromo({
    config: pricingConfig,
    deliveryFee,
    items,
    now,
    rawCode: requestData.promoCode,
    restaurantBasis,
    restaurantId,
    tip: tipAmount,
  });

  if ('rejected' in promoResolution) {
    fail(412, promoRejectionMessage(promoResolution.rejected));
  }

  const resolvedPromo = 'resolved' in promoResolution ? promoResolution.resolved : null;

  const pricing = calculateOrderPricing({
    config: pricingConfig,
    deliveryFee,
    discount: resolvedPromo?.discount ?? null,
    items,
    tip: tipAmount,
  });

  // Task 18 (G2): optional scheduled slot. Absent/blank → an immediate order,
  // and the rest of the pipeline is byte-for-byte unchanged. Present → validate
  // the slot in restaurant-local time against RestaurantHours (future, within
  // the 7-day horizon, inside opening hours for that local day-of-week,
  // respecting isClosed). An invalid slot is a client-safe 412.
  const rawScheduledFor = sanitizeText(requestData.scheduledFor);
  let scheduledFor: string | null = null;
  if (rawScheduledFor) {
    const hours = await loadRestaurantHours(restaurantId);
    const slot = validateScheduledSlot({ scheduledFor: rawScheduledFor, hours, now: now.getTime() });
    if (!slot.ok) {
      fail(412, scheduledSlotRejectionMessage(slot.reason));
    }
    scheduledFor = (slot as { ok: true; scheduledForIso: string }).scheduledForIso;
  }

  return {
    deliveryLocation,
    fulfillmentType,
    idempotencyKey,
    items,
    paymentMethod,
    pricing,
    scheduledFor,
    deviceSessionId,
    // Present only when a discount actually applies (pricing.discount > 0); the
    // handler redeems it atomically once the order id exists.
    resolvedPromo: resolvedPromo && pricing.discount > 0 ? resolvedPromo : null,
    restaurant,
    restaurantId,
  };
};

const createOrderWithItems = async ({
  attributedPromoId,
  customerId,
  deliveryLocation,
  fulfillmentType,
  items,
  orderId,
  payment,
  pricing,
  restaurantId,
  restaurantName,
  scheduledFor = null,
}: {
  attributedPromoId?: string | null;
  customerId: string;
  deliveryLocation: JsonObject | null;
  fulfillmentType: string;
  items: Array<{
    basePrice: number;
    id: string;
    name: string;
    price: number;
    quantity: number;
    restaurantId: string;
    restaurantName: string;
  }>;
  orderId: string;
  payment: JsonObject;
  pricing: JsonObject;
  restaurantId: string;
  restaurantName: string;
  scheduledFor?: string | null;
}) => {
  const createdAt = nowIso();
  // Task 18 (G2): a scheduled order lands in 'scheduled' (pre-kitchen) and its
  // timeline carries scheduledAt/scheduledFor but deliberately NO placedAt —
  // placedAt is stamped later, by the release sweep, so the acceptance-deadline
  // clock starts at release, not at scheduling. An immediate order is unchanged:
  // status 'placed' with timeline.placedAt = createdAt.
  const timeline: JsonObject = scheduledFor
    ? { scheduledAt: createdAt, scheduledFor }
    : { placedAt: createdAt };
  const status = scheduledFor ? ORDER_STATUS.SCHEDULED : ORDER_STATUS.PLACED;

  const orderInsert = {
    id: orderId,
    customerId,
    restaurantId,
    restaurantName,
    status,
    fulfillmentType,
    pricing,
    payment,
    deliveryAddress: sanitizeOptionalText(deliveryLocation?.address),
    deliveryLocation,
    attributedPromoId: attributedPromoId ?? null,
    cancellation: null,
    scheduledFor,
    timeline,
    createdAt,
    updatedAt: createdAt,
  };

  const { error: orderError } = await serviceClient.from('CustomerOrder').insert(orderInsert);
  if (orderError) {
    throw new Error(orderError.message);
  }

  const { error: itemsError } = await serviceClient.from('OrderItem').insert(
    items.map((item) => ({
      orderId,
      itemId: item.id,
      name: item.name,
      basePrice: item.basePrice,
      optionDelta: item.optionDelta ?? 0,
      price: item.price,
      quantity: item.quantity,
      restaurantId: item.restaurantId,
      restaurantName: item.restaurantName,
      selectedOptions: item.selectedOptions ?? [],
    }))
  );

  if (itemsError) {
    await serviceClient.from('CustomerOrder').delete().eq('id', orderId);
    throw new Error(itemsError.message);
  }

  await broadcastOrderChanged(orderId, { restaurantId });

  return {
    createdAt,
    timeline,
  };
};

const createOrderGroupWithItems = async ({
  attributedPromoId,
  customerId,
  deliveryLocation,
  fulfillmentType,
  groupId,
  orders,
  payment,
  paymentMethod,
  pricing,
  scheduledFor = null,
}: {
  attributedPromoId?: string | null;
  customerId: string;
  deliveryLocation: JsonObject | null;
  fulfillmentType: string;
  groupId: string;
  orders: PreparedRestaurantOrderDraft[];
  payment: JsonObject;
  paymentMethod: string;
  pricing: JsonObject;
  scheduledFor?: string | null;
}) => {
  const createdAt = nowIso();
  const timeline: JsonObject = scheduledFor ? { scheduledAt: createdAt, scheduledFor } : { placedAt: createdAt };
  const status = scheduledFor ? ORDER_STATUS.SCHEDULED : ORDER_STATUS.PLACED;
  const primaryOrderId = orders[0]?.orderId ?? groupId;
  const orderIds = orders.map((order) => order.orderId);
  const restaurantIds = orders.map((order) => order.restaurantId);
  const settlementSummary = resolvePaymentSettlementSummary(orders[0]?.restaurant ?? { paystackSubaccountCode: null }, orders.length === 1);
  const groupPayment = {
    ...payment,
    settlement: pricing.settlement ?? payment.settlement ?? null,
  };

  const createdOrderIds: string[] = [];
  try {
    for (const order of orders) {
      const orderPayment = buildInitialPaymentSummary({
        paymentMethod,
        reference: sanitizeOptionalText(payment.reference),
        accessCode: sanitizeOptionalText(payment.accessCode),
        authorizationUrl: sanitizeOptionalText(payment.authorizationUrl),
        deviceSessionId: sanitizeOptionalText(payment.deviceSessionId),
        settlementMode: settlementSummary.settlementMode,
        splitSubaccountCode: settlementSummary.splitSubaccountCode,
        settlement: (order.pricing.settlement ?? null) as JsonObject | null,
      });

      const orderInsert = {
        attributedPromoId: attributedPromoId ?? null,
        cancellation: null,
        createdAt,
        customerId,
        deliveryAddress: sanitizeOptionalText(deliveryLocation?.address),
        deliveryLocation,
        fulfillmentType,
        id: order.orderId,
        orderGroupId: groupId,
        payment: orderPayment,
        pricing: order.pricing,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurantName,
        scheduledFor,
        status,
        timeline,
        updatedAt: createdAt,
      };

      const { error: orderError } = await serviceClient.from('CustomerOrder').insert(orderInsert);
      if (orderError) {
        throw new Error(orderError.message);
      }

      const { error: itemsError } = await serviceClient.from('OrderItem').insert(
        order.items.map((item) => ({
          orderId: order.orderId,
          itemId: item.id,
          name: item.name,
          basePrice: item.basePrice,
          optionDelta: item.optionDelta ?? 0,
          price: item.price,
          quantity: item.quantity,
          restaurantId: item.restaurantId,
          restaurantName: item.restaurantName,
          selectedOptions: item.selectedOptions ?? [],
        }))
      );

      if (itemsError) {
        throw new Error(itemsError.message);
      }

      createdOrderIds.push(order.orderId);
      await broadcastOrderChanged(order.orderId, { restaurantId: order.restaurantId });
    }

    const { error: groupError } = await serviceClient.from('OrderGroup').insert({
      createdAt,
      customerId,
      id: groupId,
      orderCount: orders.length,
      orderIds,
      payment: groupPayment,
      pricing,
      primaryOrderId,
      restaurantCount: restaurantIds.length,
      restaurantIds,
      updatedAt: createdAt,
    });

    if (groupError) {
      throw new Error(groupError.message);
    }
  } catch (error) {
    await serviceClient.from('CustomerOrder').delete().in('id', createdOrderIds);
    await serviceClient.from('OrderItem').delete().in('orderId', createdOrderIds);
    await serviceClient.from('OrderGroup').delete().eq('id', groupId);
    throw error;
  }

  return {
    createdAt,
    timeline,
  };
};

// Exported so the acceptance-deadline sweep (Task 14 / E3) can issue its full
// refund through the SAME recorded-only mechanism cancelCustomerOrder uses,
// rather than inventing a second one: it writes the refund into the order's
// payment ledger (refundAmount / refundedAt / status = 'refunded'); there is no
// separate Paystack execution step here, and the sweep must not add one.
export const buildRefundUpdate = ({
  order,
  refundRate,
  reason,
}: {
  order: CustomerOrderRow;
  refundRate: number;
  reason: string;
}) => {
  const existingPayment = (order.payment ?? {}) as JsonObject;
  const paymentMethod = sanitizeText(existingPayment.method, 'cash');
  const capturedAmount = roundCurrency(
    parseNumber(existingPayment.capturedAmount, parseNumber((order.pricing ?? {}).total, 0))
  );

  if (!PREPAID_PAYMENT_METHODS.has(paymentMethod) || capturedAmount <= 0) {
    return {
      ...existingPayment,
      lastEvent: reason,
    };
  }

  const refundAmount = roundCurrency(capturedAmount * refundRate);
  return {
    ...existingPayment,
    lastEvent: reason,
    refundAmount,
    refundedAt: nowIso(),
    status: PAYMENT_STATUS.REFUNDED,
  };
};

const getCustomerCancellationRefundRate = (currentStatus: string) => {
  // Task 18 (G2): a scheduled order cancelled before release is a FULL refund —
  // the kitchen never engaged, so the customer did nothing wrong.
  if ([ORDER_STATUS.SCHEDULED, ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
    return 1;
  }

  if ([ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
    return 0.5;
  }

  return 0;
};

const loadOrderGroupOrders = async (order: CustomerOrderRow): Promise<CustomerOrderRow[]> => {
  const groupId = sanitizeText(order.orderGroupId);
  if (!groupId) {
    return [order];
  }

  const { data, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq('orderGroupId', groupId)
    .order('createdAt', { ascending: true })
    .returns<CustomerOrderRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as CustomerOrderRow[];
  return rows.length > 0 ? rows : [order];
};

const loadOrderGroupSummary = async (order: CustomerOrderRow): Promise<OrderGroupRow | null> => {
  const groupId = sanitizeText(order.orderGroupId);
  if (!groupId) {
    return null;
  }

  const { data, error } = await serviceClient
    .from('OrderGroup')
    .select(ORDER_GROUP_COLUMNS)
    .eq('id', groupId)
    .maybeSingle<OrderGroupRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

/** Folds a verified Paystack transaction into the order + payment ledger. */
const syncOrderPaymentState = async ({
  order,
  transactionData,
  webhookEvent = null,
}: {
  order: CustomerOrderRow;
  transactionData: JsonObject;
  webhookEvent?: JsonObject | null;
}) => {
  const verifiedAtIso = nowIso();
  const existingPayment = (order.payment ?? {}) as JsonObject;
  const paymentMethod = sanitizeText(
    existingPayment.method,
    sanitizeText(transactionData.channel) === 'bank_transfer' ? 'bank_transfer' : 'card'
  );
  const paymentReference = sanitizeText(transactionData.reference, sanitizeText(existingPayment.reference));
  const transactionStatus = sanitizeText(transactionData.status, 'pending');
  const gatewayStatus = sanitizeText(
    transactionData.gateway_response ?? transactionData.gatewayResponse ?? transactionStatus,
    transactionStatus
  );
  const transactionAmount = fromKoboAmount(transactionData.amount);
  const groupOrders = await loadOrderGroupOrders(order);
  const groupSummary = await loadOrderGroupSummary(order);
  const expectedAmount = parseNumber(groupSummary?.pricing?.total, parseNumber(order.pricing?.total, 0));

  let nextPayment: JsonObject = {
    ...existingPayment,
    accessCode: sanitizeOptionalText(existingPayment.accessCode),
    authorizationUrl: sanitizeOptionalText(existingPayment.authorizationUrl),
    method: paymentMethod,
    processor: PAYMENT_PROVIDER_PAYSTACK,
    reference: paymentReference,
    settlementMode: sanitizeText(
      existingPayment.settlementMode,
      sanitizeOptionalText(existingPayment.splitSubaccountCode) ? 'split' : 'manual'
    ),
    splitSubaccountCode: sanitizeOptionalText(existingPayment.splitSubaccountCode),
    verifiedAt: verifiedAtIso,
  };

  if (transactionStatus === 'success') {
    nextPayment = {
      ...nextPayment,
      capturedAmount: transactionAmount,
      channel: sanitizeOptionalText(transactionData.channel) ?? sanitizeOptionalText(nextPayment.channel),
      lastEvent: 'paystack_payment_confirmed',
      paidAt:
        sanitizeOptionalText(transactionData.paid_at ?? transactionData.transaction_date) ?? verifiedAtIso,
      status: PAYMENT_STATUS.PAID,
    };
  } else if (['abandoned', 'failed', 'reversed'].includes(transactionStatus)) {
    nextPayment = {
      ...nextPayment,
      channel: sanitizeOptionalText(transactionData.channel) ?? sanitizeOptionalText(nextPayment.channel),
      lastEvent: `paystack_${transactionStatus}`,
      status: PAYMENT_STATUS.FAILED,
    };
  } else {
    nextPayment = {
      ...nextPayment,
      channel: sanitizeOptionalText(transactionData.channel) ?? sanitizeOptionalText(nextPayment.channel),
      lastEvent: `paystack_${transactionStatus}`,
      status: PAYMENT_STATUS.PENDING,
    };
  }

  for (const groupOrder of groupOrders) {
    const orderPayment = {
      ...nextPayment,
      capturedAmount:
        sanitizeText(nextPayment.status) === PAYMENT_STATUS.PAID
          ? parseNumber(groupOrder.pricing?.total, expectedAmount)
          : parseNumber(groupOrder.payment?.capturedAmount, 0),
    };

    await updateOrderRecord(groupOrder.id, {
      payment: orderPayment,
      updatedAt: verifiedAtIso,
    });
  }

  await upsertPaymentTransaction({
    orderId: order.id,
    customerId: order.customerId,
    restaurantId: order.restaurantId,
    orderGroupId: sanitizeText(order.orderGroupId) || null,
    provider: PAYMENT_PROVIDER_PAYSTACK,
    method: paymentMethod,
    reference: paymentReference,
    currency: DEFAULT_CURRENCY,
    amount: expectedAmount,
    splitSubaccountCode: sanitizeOptionalText(nextPayment.splitSubaccountCode),
    settlementMode: sanitizeText(nextPayment.settlementMode, 'manual'),
    status: sanitizeText(nextPayment.status, PAYMENT_STATUS.PENDING),
    accessCode: sanitizeOptionalText(existingPayment.accessCode),
    authorizationUrl: sanitizeOptionalText(existingPayment.authorizationUrl),
    externalTransactionId:
      transactionData.id === null || transactionData.id === undefined ? null : String(transactionData.id),
    channel: sanitizeOptionalText(transactionData.channel),
    gatewayStatus,
    lastError:
      sanitizeText(nextPayment.status) === PAYMENT_STATUS.FAILED
        ? sanitizeOptionalText(transactionData.message) ?? gatewayStatus
        : null,
    paidAt: sanitizeText(nextPayment.status) === PAYMENT_STATUS.PAID ? nextPayment.paidAt ?? verifiedAtIso : null,
    failedAt: sanitizeText(nextPayment.status) === PAYMENT_STATUS.FAILED ? verifiedAtIso : null,
    verifiedAt: verifiedAtIso,
    verificationResponse: transactionData,
    webhookEvent,
    updatedAt: verifiedAtIso,
  });

  await capturePaymentVerificationRiskSignals({
    customerId: order.customerId,
    orderId: order.id,
    paymentReference,
    transactionData,
  });

  if (sanitizeText(nextPayment.status) === PAYMENT_STATUS.PAID) {
    for (const groupOrder of groupOrders) {
      await insertDeliveryEvent({
        orderId: groupOrder.id,
        eventType: 'payment_confirmed',
        actorUid: null,
        details: {
          amount: transactionAmount,
          provider: PAYMENT_PROVIDER_PAYSTACK,
          reference: paymentReference,
        },
      });
      await notifyRestaurantUsers(groupOrder.restaurantId, {
        title: 'Paid order received',
        body: `Order ${groupOrder.id.slice(-6).toUpperCase()} is paid and ready for confirmation.`,
        data: buildNotificationData({
          app: 'partner',
          orderId: groupOrder.id,
          routeKey: 'partner_order_detail',
          type: 'order_update',
        }),
      });
    }
  }

  return nextPayment;
};

const refreshPaystackPaymentForOrder = async (order: CustomerOrderRow, webhookEvent: JsonObject | null = null) => {
  const paymentReference = sanitizeText(order.payment?.reference);
  if (!paymentReference) {
    fail(412, 'This order does not have a Paystack reference to verify.');
  }

  const { data: paymentRecord, error: paymentError } = await serviceClient
    .from('PaymentTransaction')
    .select(
      'orderId,orderGroupId,customerId,restaurantId,method,reference,status,accessCode,authorizationUrl,channel,gatewayStatus,lastError'
    )
    .eq('reference', paymentReference)
    .maybeSingle<PaymentTransactionRow>();

  if (paymentError) {
    throw new Error(paymentError.message);
  }

  const verifiedTransaction = await verifyPaystackTransaction(paymentReference);
  const groupSummary = await loadOrderGroupSummary(order);
  const expectedAmountKobo = toKoboAmount(parseNumber(groupSummary?.pricing?.total, parseNumber((order.pricing ?? {}).total, 0)));
  const actualAmountKobo = parseInteger(verifiedTransaction.amount, -1);

  // The gateway is authoritative about *whether* money moved, never about how
  // much: a mismatch here means the reference does not belong to this order.
  if (actualAmountKobo !== expectedAmountKobo) {
    fail(412, 'Verified Paystack amount does not match the expected order total.');
  }

  return syncOrderPaymentState({
    order,
    transactionData: verifiedTransaction,
    webhookEvent,
  });
};

const customerGetOrders: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer', 'admin']);
  const targetCustomerId = context.role === 'admin' ? sanitizeText(data.customerId, context.uid) : context.uid;
  const orders = await loadOrdersForCustomer(targetCustomerId);
  return json(
    200,
    { data: { orders } },
    { 'Cache-Control': 'private, max-age=10, must-revalidate' }
  );
};

type CoordinatePair = { latitude: number; longitude: number };

/** Reads a finite {latitude, longitude} pair from an unknown, or null. */
const readCoordinatePair = (value: unknown): CoordinatePair | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const latitude = record.latitude;
  const longitude = record.longitude;

  if (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude)
  ) {
    return { latitude, longitude };
  }

  return null;
};

const customerGetOrderDetail: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer', 'admin']);
  const orderId = sanitizeText(data.orderId);
  if (!orderId) {
    fail(400, 'An order id is required.');
  }

  const bundle = await loadOrderBundle(orderId);
  if (!bundle) {
    fail(404, 'The selected order could not be found.');
  }

  if (context.role !== 'admin' && sanitizeText(bundle.order.customerId) !== context.uid) {
    fail(403, 'You can only view your own orders.');
  }

  const riderSnapshot = await loadDispatchRiderSnapshot(bundle.assignment?.courierId);
  const orderGroup = await loadOrderGroupSummary(bundle.order);
  const orderGroupId = sanitizeText(bundle.order.orderGroupId);
  const groupOrders = orderGroupId ? await loadOrderGroupOrders(bundle.order) : [];
  const groupOrderRelations =
    orderGroupId && groupOrders.length > 0 ? await loadOrderRelations(groupOrders.map((groupOrder) => groupOrder.id)) : null;

  // Live-tracking extras for the customer map. Restaurant coordinates pin the
  // origin (public, non-sensitive); the tracking config gives the average
  // speed for the ETA. Both reads are best-effort: a missing restaurant row or
  // an unreadable settings row must not break order detail, so failures fall
  // back to null/defaults rather than throwing.
  const restaurantTiming = await loadRestaurantTimingContext(bundle!.order.restaurantId);
  const trackingConfig = await loadDispatchTrackingConfig();
  // bundle! : narrowed non-null by the fail() guard above (fail returns never),
  // but that narrowing does not carry across the awaits in between under deno
  // check - the same pre-existing, already-baselined pattern this file uses
  // for bundle elsewhere (see dispatchAssignOrderCourier's bundle! note).
  const deliveryCoordinates = readCoordinatePair(bundle!.order.deliveryLocation);
  const acceptedAtIso =
    sanitizeText((bundle!.order.timeline as { acceptedAt?: unknown } | null | undefined)?.acceptedAt) ||
    sanitizeText(bundle!.order.createdAt) ||
    '';
  const prepEstimate = await loadRestaurantPrepTimeEstimate({
    acceptedAtIso,
    fallbackDeliveryTime: restaurantTiming?.deliveryTime ?? null,
    restaurantId: bundle!.order.restaurantId,
  });
  const restaurantCoordinates =
    restaurantTiming && typeof restaurantTiming.latitude === 'number' && typeof restaurantTiming.longitude === 'number'
      ? { latitude: restaurantTiming.latitude, longitude: restaurantTiming.longitude }
      : null;

  const prepEtaRange =
    restaurantCoordinates && deliveryCoordinates
      ? computeEtaRange(
          haversineKm(
            restaurantCoordinates.latitude,
            restaurantCoordinates.longitude,
            deliveryCoordinates.latitude,
            deliveryCoordinates.longitude
          ),
          trackingConfig.averageSpeedKmh
        )
      : null;
  const orderEta = {
    minMinutes: prepEstimate.minutes + (prepEtaRange?.minMinutes ?? 0),
    maxMinutes: prepEstimate.minutes + (prepEtaRange?.maxMinutes ?? 0),
  };

  const orderSnapshot = toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment, [], {
    ...riderSnapshot,
    averageSpeedKmh: trackingConfig.averageSpeedKmh,
    eta: { maxMinutes: orderEta.maxMinutes, minMinutes: orderEta.minMinutes },
    orderGroup,
    restaurantLatitude: restaurantCoordinates?.latitude ?? null,
    restaurantLongitude: restaurantCoordinates?.longitude ?? null,
  });

  return json(
    200,
    {
      data: {
        order:
          groupOrderRelations && groupOrders.length > 0
            ? {
                ...orderSnapshot,
                groupOrders: groupOrders.map((groupOrder) =>
                  toOrderSnapshotResponse(
                    groupOrder,
                    groupOrderRelations.itemsByOrderId.get(groupOrder.id) ?? [],
                    groupOrderRelations.assignmentsByOrderId.get(groupOrder.id) ?? null
                  )
                ),
              }
            : orderSnapshot,
      },
    },
    { 'Cache-Control': 'private, max-age=6, must-revalidate' }
  );
};

const customerListFavoriteRestaurants: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer', 'admin']);
  const targetCustomerId = context.role === 'admin' ? sanitizeText(data.customerId, context.uid) : context.uid;
  const restaurantIds = await loadFavoriteRestaurantIds(targetCustomerId);
  return json(200, { data: { restaurantIds } });
};

const customerToggleFavoriteRestaurant: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer', 'admin']);
  const restaurantId = sanitizeText(data.restaurantId);
  const requestedFavoriteState =
    typeof data.isFavorite === 'boolean' ? data.isFavorite : null;

  if (!restaurantId) {
    fail(400, 'A restaurant id is required.');
  }

  const { restaurant } = await loadRestaurantById(restaurantId);
  if (!restaurant || restaurant.isPublished !== true) {
    fail(404, 'This restaurant is not available for favorites.');
  }

  const customerId = context.role === 'admin' ? sanitizeText(data.customerId, context.uid) : context.uid;
  const favoriteIds = new Set(await loadFavoriteRestaurantIds(customerId));
  const isCurrentlyFavorite = favoriteIds.has(restaurantId);
  const shouldBeFavorite = requestedFavoriteState ?? !isCurrentlyFavorite;

  if (shouldBeFavorite && !isCurrentlyFavorite) {
    const now = nowIso();
    const { error } = await serviceClient.from('CustomerFavoriteRestaurant').upsert(
      {
        id: `${customerId}_${restaurantId}`,
        customerId,
        restaurantId,
        createdAt: now,
        updatedAt: now,
      },
      { onConflict: 'customerId,restaurantId' }
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  if (!shouldBeFavorite && isCurrentlyFavorite) {
    const { error } = await serviceClient
      .from('CustomerFavoriteRestaurant')
      .delete()
      .eq('customerId', customerId)
      .eq('restaurantId', restaurantId);

    if (error) {
      throw new Error(error.message);
    }
  }

  const restaurantIds = await loadFavoriteRestaurantIds(customerId);
  return json(200, {
    data: {
      isFavorite: shouldBeFavorite,
      restaurantId,
      restaurantIds,
    },
  });
};

const placeCustomerOrder: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer']);
  const orderDraft = await prepareCustomerOrderDraft(data, ['cash']);
  const idempotencyKey = orderDraft.idempotencyKey
    ? `${context.uid}:place_customer_order:${orderDraft.idempotencyKey}`
    : null;

  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(idempotencyKey);
    if (existing?.response) {
      return json(200, { data: existing.response });
    }
  }

  const groupedOrders = Array.isArray((orderDraft as { orders?: unknown }).orders)
    ? (orderDraft as { orders: PreparedRestaurantOrderDraft[] }).orders
    : null;
  const orderId = groupedOrders?.[0]?.orderId ?? crypto.randomUUID();
  // Redeem BEFORE the order row lands: a cap-busted code fails here (409) and
  // no order is created; and if order creation then throws, the redemption is
  // released so a failed placement never consumes a cap slot.
  await redeemResolvedPromoOrFail(orderDraft.resolvedPromo, context.uid, orderId, orderDraft.pricing.discount);
  const payment = buildInitialPaymentSummary({
    paymentMethod: orderDraft.paymentMethod,
    settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
    deviceSessionId: sanitizeOptionalText(orderDraft.deviceSessionId),
  });

  // Task 18 (G2): a scheduled order lands in 'scheduled', an immediate one in
  // 'placed'. Everything else on this path is unchanged.
  const landedStatus = orderDraft.scheduledFor ? ORDER_STATUS.SCHEDULED : ORDER_STATUS.PLACED;

  let orderCreation: { createdAt: string; timeline: JsonObject };
  try {
    if (groupedOrders) {
      orderCreation = await createOrderGroupWithItems({
        customerId: context.uid,
        deliveryLocation: orderDraft.deliveryLocation,
        fulfillmentType: orderDraft.fulfillmentType,
        groupId: orderId,
        orders: groupedOrders,
        payment,
        paymentMethod: orderDraft.paymentMethod,
        pricing: orderDraft.pricing,
        scheduledFor: orderDraft.scheduledFor,
      });
    } else {
      orderCreation = await createOrderWithItems({
        customerId: context.uid,
        deliveryLocation: orderDraft.deliveryLocation,
        fulfillmentType: orderDraft.fulfillmentType,
        items: orderDraft.items,
        orderId,
        payment,
        pricing: orderDraft.pricing,
        restaurantId: orderDraft.restaurantId,
        restaurantName: sanitizeText(
          (orderDraft as { restaurant?: RestaurantRecordRow }).restaurant?.name,
          'Restaurant'
        ),
        scheduledFor: orderDraft.scheduledFor,
      });
    }
  } catch (error) {
    if (orderDraft.resolvedPromo) {
      await releasePromoRedemption(orderId);
    }
    throw error;
  }

  await insertDeliveryEvent({
    orderId,
    eventType: 'order_placed',
    actorUid: context.uid,
    details: {
      fulfillmentType: orderDraft.fulfillmentType,
      paymentMethod: orderDraft.paymentMethod,
      scheduledFor: orderDraft.scheduledFor,
      total: orderDraft.pricing.total,
    },
  });

  await captureOrderPlacementRiskSignals({
    customerId: context.uid,
    deviceSessionId: sanitizeOptionalText(orderDraft.deviceSessionId),
    orderId,
  });

  const response = {
    orderId,
    paymentStatus: sanitizeText(payment.status, PAYMENT_STATUS.PENDING),
    scheduledFor: orderDraft.scheduledFor,
    status: landedStatus,
    total: orderDraft.pricing.total,
  };

  if (idempotencyKey) {
    await storeIdempotencyRecord(idempotencyKey, 'place_customer_order', context.uid, response);
  }

  if (groupedOrders) {
    for (const restaurantOrder of groupedOrders) {
      await notifyRestaurantUsers(restaurantOrder.restaurantId, {
        title: 'New cash order',
        body: `Order ${orderId.slice(-6).toUpperCase()} is waiting for restaurant confirmation.`,
        data: buildNotificationData({
          app: 'partner',
          orderId: restaurantOrder.orderId,
          routeKey: 'partner_order_detail',
          type: 'order_update',
        }),
      });
    }
  } else {
    await notifyRestaurantUsers(orderDraft.restaurantId, {
      title: 'New cash order',
      body: `Order ${orderId.slice(-6).toUpperCase()} is waiting for restaurant confirmation.`,
      data: buildNotificationData({
        app: 'partner',
        orderId,
        routeKey: 'partner_order_detail',
        type: 'order_update',
      }),
    });
  }

  await notifySafely(async () => {
    const restaurantName = sanitizeText(
      (orderDraft as { primaryRestaurant?: RestaurantRecordRow | null }).primaryRestaurant?.name ??
        (orderDraft as { restaurant?: RestaurantRecordRow | null }).restaurant?.name,
      'the restaurant'
    );
    await sendTransactionalEmail({
      to: context.email,
      subject: `Order ${shortOrderCode(orderId)} placed`,
      html: buildTransactionalEmailHtml({
        heading: 'Your order has been placed',
        lines: [
          groupedOrders
            ? `We received your multi-store order ${shortOrderCode(orderId)} for ${restaurantName} and other selected restaurants.`
            : `We received your order ${shortOrderCode(orderId)} for ${restaurantName}.`,
          `Total: ${formatNairaAmount(orderDraft.pricing.total)} (pay with cash on ${
            orderDraft.fulfillmentType === 'delivery' ? 'delivery' : 'pickup'
          }).`,
          'We will keep you posted as the restaurant confirms and prepares your order.',
        ],
      }),
    });
  });

  return json(200, { data: response });
};

const initializeCustomerPayment: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer']);
  assertPaystackConfigured();

  const orderDraft = await prepareCustomerOrderDraft(data, ['card', 'bank_transfer']);
  if (!PAYSTACK_PAYMENT_METHODS.has(orderDraft.paymentMethod)) {
    fail(412, 'Only card and bank transfer are supported for Paystack checkout.');
  }

  const idempotencyKey = orderDraft.idempotencyKey
    ? `${context.uid}:initialize_customer_payment:${orderDraft.idempotencyKey}`
    : null;

  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(idempotencyKey);
    if (existing?.response) {
      return json(200, { data: existing.response });
    }
  }

  const groupedOrders = Array.isArray((orderDraft as { orders?: unknown }).orders)
    ? (orderDraft as { orders: PreparedRestaurantOrderDraft[] }).orders
    : null;
  const orderId = groupedOrders?.[0]?.orderId ?? crypto.randomUUID();
  const rawAttributedPromoId = sanitizeText(data.attributedPromoId);
  const attributedPromoId =
    rawAttributedPromoId && rawAttributedPromoId.length <= 128 ? rawAttributedPromoId : null;
  const paymentReference = buildPaystackReference(orderId, orderDraft.paymentMethod);
  const paymentSettlement = resolvePaymentSettlementSummary(
    orderDraft.restaurant,
    !(groupedOrders && groupedOrders.length > 1)
  );
  const initialPayment = buildInitialPaymentSummary({
    paymentMethod: orderDraft.paymentMethod,
    reference: paymentReference,
    deviceSessionId: sanitizeOptionalText(orderDraft.deviceSessionId),
    settlementMode: paymentSettlement.settlementMode,
    splitSubaccountCode: paymentSettlement.splitSubaccountCode,
    settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
  });

  // Same discipline as the cash path: redeem atomically before the order lands,
  // release on any failure that leaves no live order (creation error below, or
  // the payment-initialization cancel path further down).
  await redeemResolvedPromoOrFail(orderDraft.resolvedPromo, context.uid, orderId, orderDraft.pricing.discount);

  // Task 18 (G2): payment is captured at placement exactly as for an immediate
  // order — the only difference is where the order lands (scheduled vs placed).
  const landedStatus = orderDraft.scheduledFor ? ORDER_STATUS.SCHEDULED : ORDER_STATUS.PLACED;

  let orderCreation: { createdAt: string; timeline: JsonObject };
  try {
    if (groupedOrders) {
      orderCreation = await createOrderGroupWithItems({
        attributedPromoId,
        customerId: context.uid,
        deliveryLocation: orderDraft.deliveryLocation,
        fulfillmentType: orderDraft.fulfillmentType,
        groupId: orderId,
        orders: groupedOrders,
        payment: initialPayment,
        paymentMethod: orderDraft.paymentMethod,
        pricing: orderDraft.pricing,
        scheduledFor: orderDraft.scheduledFor,
      });
    } else {
      orderCreation = await createOrderWithItems({
        attributedPromoId,
        customerId: context.uid,
        deliveryLocation: orderDraft.deliveryLocation,
        fulfillmentType: orderDraft.fulfillmentType,
        items: orderDraft.items,
        orderId,
        payment: initialPayment,
        pricing: orderDraft.pricing,
        restaurantId: orderDraft.restaurantId,
        restaurantName: sanitizeText(
          (orderDraft as { restaurant?: RestaurantRecordRow }).restaurant?.name,
          'Restaurant'
        ),
        scheduledFor: orderDraft.scheduledFor,
      });
    }
  } catch (error) {
    if (orderDraft.resolvedPromo) {
      await releasePromoRedemption(orderId);
    }
    throw error;
  }

  await upsertPaymentTransaction({
    orderId,
    customerId: context.uid,
    restaurantId: orderDraft.restaurantId,
    orderGroupId: groupedOrders ? orderId : null,
    provider: PAYMENT_PROVIDER_PAYSTACK,
    method: orderDraft.paymentMethod,
    reference: paymentReference,
    currency: DEFAULT_CURRENCY,
    amount: orderDraft.pricing.total,
    splitSubaccountCode: paymentSettlement.splitSubaccountCode,
    settlementMode: paymentSettlement.settlementMode,
    status: PAYMENT_STATUS.PENDING,
  });

  try {
    const initializedTransaction = await initializePaystackTransaction({
      amount: orderDraft.pricing.total,
      email: context.email,
      paymentMethod: orderDraft.paymentMethod,
      reference: paymentReference,
      subaccount: paymentSettlement.settlementMode === 'split' ? paymentSettlement.splitSubaccountCode : null,
      transactionCharge:
        paymentSettlement.settlementMode === 'split'
          ? roundCurrency(
              Math.max(
                parseNumber(orderDraft.pricing.total, 0) -
                  parseNumber(((orderDraft.pricing.settlement ?? {}) as JsonObject).netSettlement, 0),
                0
              )
            )
          : null,
      metadata: {
        customerId: context.uid,
        fulfillmentType: orderDraft.fulfillmentType,
        orderId,
        paymentMethod: orderDraft.paymentMethod,
        restaurantId: orderDraft.restaurantId,
        source: 'ebuy_customer_checkout',
      },
      callbackUrl: getNormalizedPaystackCallbackUrl(data.callbackUrl),
    });

    const paymentWithAuthorization = buildInitialPaymentSummary({
      paymentMethod: orderDraft.paymentMethod,
      reference: paymentReference,
      accessCode: sanitizeOptionalText(initializedTransaction.access_code),
      authorizationUrl: sanitizeOptionalText(initializedTransaction.authorization_url),
      deviceSessionId: sanitizeOptionalText(orderDraft.deviceSessionId),
      settlementMode: paymentSettlement.settlementMode,
      splitSubaccountCode: paymentSettlement.splitSubaccountCode,
      settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
    });

    if (groupedOrders) {
      for (const restaurantOrder of groupedOrders) {
        await updateOrderRecord(restaurantOrder.orderId, {
          payment: buildInitialPaymentSummary({
            paymentMethod: orderDraft.paymentMethod,
            reference: paymentReference,
            accessCode: sanitizeOptionalText(initializedTransaction.access_code),
            authorizationUrl: sanitizeOptionalText(initializedTransaction.authorization_url),
            deviceSessionId: sanitizeOptionalText(orderDraft.deviceSessionId),
            settlementMode: paymentSettlement.settlementMode,
            splitSubaccountCode: paymentSettlement.splitSubaccountCode,
            settlement: (restaurantOrder.pricing.settlement ?? null) as JsonObject | null,
          }),
          updatedAt: nowIso(),
        });
      }
    } else {
      await updateOrderRecord(orderId, {
        payment: paymentWithAuthorization,
        updatedAt: nowIso(),
      });
    }

    await upsertPaymentTransaction({
      orderId,
      customerId: context.uid,
      restaurantId: orderDraft.restaurantId,
      orderGroupId: groupedOrders ? orderId : null,
      provider: PAYMENT_PROVIDER_PAYSTACK,
      method: orderDraft.paymentMethod,
      reference: paymentReference,
      currency: DEFAULT_CURRENCY,
      amount: orderDraft.pricing.total,
      splitSubaccountCode: paymentSettlement.splitSubaccountCode,
      settlementMode: paymentSettlement.settlementMode,
      status: PAYMENT_STATUS.PENDING,
      accessCode: sanitizeOptionalText(initializedTransaction.access_code),
      authorizationUrl: sanitizeOptionalText(initializedTransaction.authorization_url),
      initializeResponse: initializedTransaction,
    });

    await insertDeliveryEvent({
      orderId,
      eventType: 'payment_initialized',
      actorUid: context.uid,
      details: {
        paymentMethod: orderDraft.paymentMethod,
        provider: PAYMENT_PROVIDER_PAYSTACK,
        reference: paymentReference,
      },
    });

    await captureOrderPlacementRiskSignals({
      customerId: context.uid,
      deviceSessionId: sanitizeOptionalText(orderDraft.deviceSessionId),
      orderId,
    });

    const response = {
      accessCode: sanitizeOptionalText(initializedTransaction.access_code),
      authorizationUrl: sanitizeText(initializedTransaction.authorization_url),
      orderId,
      paymentStatus: PAYMENT_STATUS.PENDING,
      publicKeyPresent: Boolean(getPaystackPublicKey()),
      reference: paymentReference,
      scheduledFor: orderDraft.scheduledFor,
      status: landedStatus,
      total: orderDraft.pricing.total,
    };

    if (idempotencyKey) {
      await storeIdempotencyRecord(
        idempotencyKey,
        'initialize_customer_payment',
        context.uid,
        response
      );
    }

    return json(200, { data: response });
  } catch (paymentError) {
    // The order row already exists, so a gateway failure must leave it
    // cancelled rather than sitting in the kitchen queue unpaid.
    const failedPayment = {
      ...initialPayment,
      lastEvent: 'paystack_initialize_failed',
      processor: PAYMENT_PROVIDER_PAYSTACK,
      status: PAYMENT_STATUS.FAILED,
      verifiedAt: nowIso(),
    };

    if (groupedOrders) {
      for (const restaurantOrder of groupedOrders) {
        await updateOrderRecord(restaurantOrder.orderId, {
          cancellation: {
            actor: 'system',
            reason: 'payment_initialization_failed',
          },
          payment: buildInitialPaymentSummary({
            paymentMethod: orderDraft.paymentMethod,
            deviceSessionId: sanitizeOptionalText(orderDraft.deviceSessionId),
            settlement: (restaurantOrder.pricing.settlement ?? null) as JsonObject | null,
          }),
          status: ORDER_STATUS.CANCELLED,
          timeline: {
            ...orderCreation.timeline,
            paymentInitializationFailedAt: nowIso(),
          },
          updatedAt: nowIso(),
        });
      }
    } else {
      await updateOrderRecord(orderId, {
        cancellation: {
          actor: 'system',
          reason: 'payment_initialization_failed',
        },
        payment: failedPayment,
        status: ORDER_STATUS.CANCELLED,
        timeline: {
          ...orderCreation.timeline,
          paymentInitializationFailedAt: nowIso(),
        },
        updatedAt: nowIso(),
      });
    }

    await upsertPaymentTransaction({
      orderId,
      customerId: context.uid,
      restaurantId: orderDraft.restaurantId,
      orderGroupId: groupedOrders ? orderId : null,
      provider: PAYMENT_PROVIDER_PAYSTACK,
      method: orderDraft.paymentMethod,
      reference: paymentReference,
      currency: DEFAULT_CURRENCY,
      amount: orderDraft.pricing.total,
      status: PAYMENT_STATUS.FAILED,
      lastError: paymentError instanceof Error ? paymentError.message : String(paymentError),
      failedAt: nowIso(),
    });

    // The order is now cancelled, so its promo redemption must not keep holding
    // a cap slot — release it (best-effort; a failed release only over-counts).
    if (orderDraft.resolvedPromo) {
      await releasePromoRedemption(orderId);
    }

    throw paymentError;
  }
};

const refreshCustomerPaymentStatus: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer', 'admin']);
  const orderId = sanitizeText(data.orderId);
  if (!orderId) {
    fail(400, 'An order id is required.');
  }

  const bundle = await loadOrderBundle(orderId);
  if (!bundle) {
    fail(404, 'The selected order could not be found.');
  }

  if (context.role !== 'admin' && sanitizeText(bundle.order.customerId) !== context.uid) {
    fail(403, 'You can only refresh payment status for your own orders.');
  }

  if (!PAYSTACK_PAYMENT_METHODS.has(sanitizeText(bundle.order.payment?.method))) {
    return json(200, {
      data: {
        gatewayStatus: sanitizeText(bundle.order.payment?.lastEvent, 'cash_order'),
        orderId,
        paymentStatus: sanitizeText(bundle.order.payment?.status, PAYMENT_STATUS.PENDING),
        status: sanitizeText(bundle.order.status, ORDER_STATUS.PLACED),
      },
    });
  }

  const nextPayment = await refreshPaystackPaymentForOrder(bundle.order);
  return json(200, {
    data: {
      gatewayStatus: sanitizeText(nextPayment.lastEvent, 'verification_complete'),
      orderId,
      paymentStatus: sanitizeText(nextPayment.status, PAYMENT_STATUS.PENDING),
      status: sanitizeText(bundle.order.status, ORDER_STATUS.PLACED),
    },
  });
};

const cancelCustomerOrder: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer', 'admin']);
  const orderId = sanitizeText(data.orderId);
  if (!orderId) {
    fail(400, 'An order id is required.');
  }

  const bundle = await loadOrderBundle(orderId);
  if (!bundle) {
    fail(404, 'The selected order could not be found.');
  }

  if (context.role !== 'admin' && bundle.order.customerId !== context.uid) {
    fail(403, 'You can only cancel your own orders.');
  }

  const currentStatus = normalizeOrderStatus(bundle.order.status);
  // Cancellation is only allowed before the kitchen starts preparing — which
  // includes a scheduled order still waiting for release (Task 18 / G2).
  if (![ORDER_STATUS.SCHEDULED, ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
    fail(412, 'This order can no longer be cancelled.');
  }

  const refundRate = getCustomerCancellationRefundRate(currentStatus);
  const payment = buildRefundUpdate({
    order: bundle.order,
    refundRate,
    reason:
      refundRate === 1 ? 'customer_cancelled_full_refund' : 'customer_cancelled_partial_refund',
  });
  const timeline = {
    ...(bundle.order.timeline ?? {}),
    cancelledAt: nowIso(),
  };
  const cancellation = {
    actor: context.role === 'admin' ? 'admin' : 'customer',
    refundRate,
  };

  await updateOrderRecord(orderId, {
    cancellation,
    payment,
    status: ORDER_STATUS.CANCELLED,
    timeline,
    updatedAt: nowIso(),
  });

  // The order is now cancelled (customer/admin self-cancel, refunded per the
  // rate above): free any promo-cap slot it held so a single-use code the
  // customer cancelled out of is theirs to use again. Best-effort — a release
  // failure must not undo the cancel/refund just committed.
  await releasePromoRedemption(orderId);

  // Routed through releaseDispatchAssignmentLoad, not the plain
  // adjustDispatchRiderLoad(-1) this used to call (review round 3): this is
  // a THIRD path that can decrement the same (order, courier) claim the
  // automatic-assignment and partner/dispatcher release paths already
  // guard. Concretely reachable - AUTO_DISPATCH_ELIGIBLE_STATUSES includes
  // ACCEPTED, so a courier is claimed the moment a restaurant accepts, and
  // this handler permits cancellation from exactly [PLACED, ACCEPTED] - the
  // same states partnerUpdateOrderStatus's `reject` action permits. A
  // customer cancelling while the restaurant rejects the same accepted
  // order (or a single cancel request simply retried) would otherwise land
  // two decrements for one claimed unit: the guarded reject release
  // succeeds first, and this bare call would fire regardless of whether
  // anyone had already released. Now it shares the same loadReleasedAt
  // guard as every other release path, so only whichever one actually
  // completes first decrements.
  //
  // Called with the order id alone and unconditionally (review round 4): the
  // assignment row decides which rider holds the claim, not this handler's
  // snapshot of it. The old `if (releaseCourierId)` pre-check skipped the
  // release whenever `bundle` showed no courier - but this handler's own
  // ACCEPTED window is precisely when automatic assignment claims one, so a
  // cancel racing that claim would skip the release and strand the claim on
  // a cancelled order forever.
  try {
    await releaseDispatchAssignmentLoad(orderId);
  } catch (error) {
    logEdgeEvent('error', 'dispatch load release failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
  }

  await insertDeliveryEvent({
    orderId,
    eventType: 'order_cancelled',
    actorUid: context.uid,
    details: {
      actorRole: context.role,
      refundRate,
    },
  });

  await captureRefundAbuseSignals({
    customerId: bundle.order.customerId,
    orderId,
  });
  await notifyRestaurantUsers(bundle.order.restaurantId, {
    title: 'Order cancelled',
    body: `Order ${orderId.slice(-6).toUpperCase()} was cancelled by ${context.role}.`,
    data: buildNotificationData({
      app: 'partner',
      orderId,
      routeKey: 'partner_order_detail',
      status: ORDER_STATUS.CANCELLED,
      type: 'order_update',
    }),
  });
  if (sanitizeText(bundle.assignment?.courierId)) {
    await notifyUsers([sanitizeText(bundle.assignment?.courierId)], {
      title: 'Delivery cancelled',
      body: `Order ${orderId.slice(-6).toUpperCase()} no longer requires delivery.`,
      data: buildNotificationData({
        app: 'dispatch',
        orderId,
        routeKey: 'dispatch_delivery_detail',
        status: ORDER_STATUS.CANCELLED,
        type: 'order_update',
      }),
    });
  }

  return json(200, {
    data: {
      orderId,
      refundRate,
      status: ORDER_STATUS.CANCELLED,
    },
  });
};

const customerSendSupportMessage: Handler = async ({ context, data }) => {
  const body = sanitizeText(data.body);
  if (!body) {
    fail(400, 'A message body is required.');
  }

  // One thread per customer: find, create, or reopen if previously closed.
  const { data: existing, error: findError } = await serviceClient
    .from('SupportConversation')
    .select('*')
    .eq('customerId', context.uid)
    .maybeSingle<SupportConversationRow>();
  if (findError) {
    throw new Error(findError.message);
  }

  let conversation: SupportConversationRow;
  if (!existing) {
    const { data: created, error: createError } = await serviceClient
      .from('SupportConversation')
      .insert({ customerId: context.uid, status: 'open', subject: body.slice(0, 80) })
      .select('*')
      .single<SupportConversationRow>();
    if (createError || !created) {
      throw new Error(createError?.message ?? 'Failed to create the conversation.');
    }
    conversation = created;
  } else if (existing.status === 'closed') {
    const { data: reopened, error: reopenError } = await serviceClient
      .from('SupportConversation')
      .update({ status: 'open', updatedAt: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single<SupportConversationRow>();
    if (reopenError || !reopened) {
      throw new Error(reopenError?.message ?? 'Failed to reopen the conversation.');
    }
    conversation = reopened;
  } else {
    conversation = existing;
  }

  const message = await appendSupportMessage({
    conversationId: conversation.id,
    senderType: 'customer',
    senderId: context.uid,
    body,
  });

  await broadcastSupportInboxChanged({ conversationId: conversation.id });
  await broadcastSupportThreadChanged(conversation.id, { messageId: message.id });

  return json(200, { data: { conversation, message } });
};

// Delivered orders for this customer with no OrderRating row yet — what
// prompts the "rate your order" nudge. A plain anti-join (two selects + a Set
// filter) rather than a SQL function: this is an ordinary read, nothing here
// needs the atomicity ebuy_submit_order_rating exists for.
const customerGetPendingRatings: Handler = async ({ context }) => {
  ensureRole(context.role, ['customer']);

  const { data: orders, error: ordersError } = await serviceClient
    .from('CustomerOrder')
    .select('id,restaurantId,restaurantName,updatedAt,createdAt')
    .eq('customerId', context.uid)
    .eq('status', ORDER_STATUS.DELIVERED)
    .order('updatedAt', { ascending: false });

  if (ordersError) {
    throw new Error(ordersError.message);
  }

  const deliveredOrders = (orders ?? []) as Array<{
    createdAt?: string | null;
    id: string;
    restaurantId: string;
    restaurantName: string;
    updatedAt?: string | null;
  }>;

  if (deliveredOrders.length === 0) {
    return json(200, { data: { orders: [] } });
  }

  const orderIds = deliveredOrders.map((order) => order.id);

  const [{ data: ratings, error: ratingsError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    serviceClient.from('OrderRating').select('orderId').in('orderId', orderIds),
    // Drives the client's "only show a courier score field when this order
    // actually had a rider" rule — customerSubmitOrderRating enforces the
    // same fact server-side (it only updates DispatchRiderRecord when a
    // courierId exists on the assignment), so this just surfaces the same
    // signal to the prompt before submit.
    serviceClient.from('DeliveryAssignment').select('orderId,courierId').in('orderId', orderIds),
  ]);

  if (ratingsError) {
    throw new Error(ratingsError.message);
  }
  if (assignmentsError) {
    throw new Error(assignmentsError.message);
  }

  const ratedOrderIds = new Set(((ratings ?? []) as Array<{ orderId: string }>).map((rating) => rating.orderId));
  const courierOrderIds = new Set(
    ((assignments ?? []) as Array<{ orderId: string; courierId?: string | null }>)
      .filter((assignment) => sanitizeOptionalText(assignment.courierId))
      .map((assignment) => assignment.orderId)
  );

  const pendingOrders = deliveredOrders
    .filter((order) => !ratedOrderIds.has(order.id))
    .map((order) => ({
      deliveredAt: order.updatedAt ?? order.createdAt ?? null,
      hasCourier: courierOrderIds.has(order.id),
      orderId: order.id,
      restaurantId: order.restaurantId,
      restaurantName: sanitizeText(order.restaurantName, 'Restaurant'),
    }));

  return json(200, { data: { orders: pendingOrders } });
};

// Only on a `delivered` order the customer owns, only once — enforced in
// ebuy_submit_order_rating (20260820_order_ratings.sql): the UNIQUE on
// OrderRating.orderId is the "only once" guard, not a read-then-write check
// here, and the incremental restaurant/courier average update runs inside the
// SAME function call as the insert so a partial failure can't land one
// without the other. See that migration's header for the full race-safety
// argument.
const customerSubmitOrderRating: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer']);

  const orderId = sanitizeText(data.orderId);
  if (!orderId) {
    fail(400, 'An order id is required.');
  }

  const restaurantScore = parseInteger(data.restaurantScore, Number.NaN);
  if (!Number.isInteger(restaurantScore) || restaurantScore < 1 || restaurantScore > 5) {
    fail(400, 'A restaurant rating between 1 and 5 is required.');
  }

  let courierScore: number | null = null;
  if (data.courierScore !== undefined && data.courierScore !== null && data.courierScore !== '') {
    const parsedCourierScore = parseInteger(data.courierScore, Number.NaN);
    if (!Number.isInteger(parsedCourierScore) || parsedCourierScore < 1 || parsedCourierScore > 5) {
      fail(400, 'A courier rating between 1 and 5 is required.');
    }
    courierScore = parsedCourierScore;
  }

  const comment = sanitizeOptionalText(data.comment);

  const { data: rpcRows, error: rpcError } = await serviceClient.rpc('ebuy_submit_order_rating', {
    p_order_id: orderId,
    p_customer_id: context.uid,
    p_restaurant_score: restaurantScore,
    p_courier_score: courierScore,
    p_comment: comment,
  });

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  const result = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as
    | { ratingId?: string | null; reason?: string | null; restaurantId?: string | null; submitted?: boolean }
    | undefined;

  if (!result?.submitted) {
    const reason = sanitizeText(result?.reason, 'rating_failed');

    if (reason === 'order_not_found') {
      fail(404, 'The selected order could not be found.');
    }
    if (reason === 'not_owner') {
      fail(403, 'You can only rate your own orders.');
    }
    if (reason === 'not_delivered') {
      fail(412, 'Only a delivered order can be rated.');
    }
    if (reason === 'already_rated') {
      fail(409, 'This order has already been rated.');
    }

    fail(400, 'This order could not be rated.');
  }

  return json(200, {
    data: {
      orderId,
      ratingId: sanitizeOptionalText(result?.ratingId),
      restaurantId: sanitizeOptionalText(result?.restaurantId),
    },
  });
};

// Cart preview for the discount engine. ADVISORY ONLY: it re-runs the exact
// server-side validation (window/scope/min-basket) and the exact pricing.ts
// discount math the placement path will run, so the number shown matches what
// will be charged — but it does NOT redeem, does NOT create an order, and does
// NOT consume a usage cap. Placement re-validates and redeems atomically; a
// code that previews fine can still be refused at placement if its cap fills
// in between, which is correct.
const customerValidatePromoCode: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['customer']);

  const restaurantId = sanitizeText(data.restaurantId);
  if (!restaurantId) {
    fail(400, 'A restaurant is required to check a promo code.');
  }

  const fulfillmentType = sanitizeText(data.fulfillmentType, 'delivery');
  const { restaurant } = await loadRestaurantById(restaurantId);
  if (!restaurant) {
    fail(404, 'The selected restaurant no longer exists.');
  }
  // `fail` throws, but deno check does not narrow `restaurant` past it (the
  // same tracked fail()-then-use gap this file documents elsewhere); bind a
  // non-null local so the promo preview adds no new baseline errors.
  const activeRestaurant = restaurant as RestaurantRecordRow;

  const now = new Date();
  const pricingConfig = await loadPricingConfig();
  const items = buildOrderItems(data.items, restaurantId, activeRestaurant, pricingConfig, now);
  const restaurantBasis = items.reduce(
    (sum: number, item: { basePrice: number; quantity: number }) => sum + item.basePrice * item.quantity,
    0
  );
  const deliveryFee = fulfillmentType === 'delivery' ? parseNumber(activeRestaurant.deliveryFee, 0) : 0;
  const tip = roundCurrency(parseNumber(data.tipAmount, 0));

  const code = normalizePromoCode(data.promoCode);
  const resolution = await resolveBasketPromo({
    config: pricingConfig,
    deliveryFee,
    items,
    now,
    rawCode: data.promoCode,
    restaurantBasis,
    restaurantId,
    tip,
  });

  // A manually-entered code that failed validation: surface a client-safe
  // reason and the undiscounted totals.
  if ('rejected' in resolution) {
    const baseline = calculateOrderPricing({ config: pricingConfig, deliveryFee, items, tip });
    return json(200, {
      data: {
        applied: null,
        automaticOffers: [],
        code: code || null,
        discount: 0,
        message: promoRejectionMessage(resolution.rejected),
        subtotal: baseline.subtotal,
        total: baseline.total,
        valid: false,
      },
    });
  }

  const resolved = resolution.resolved;
  const pricing = calculateOrderPricing({
    config: pricingConfig,
    deliveryFee,
    discount: resolved?.discount ?? null,
    items,
    tip,
  });

  // Eligible automatic offers for display, each with its previewed discount.
  const automatic = await loadAutomaticPromoCodes(restaurantId);
  const automaticOffers = automatic
    .map((promoCode) => {
      const result = validatePromoCodeForBasket({ promoCode, restaurantId, restaurantBasis, now });
      if (!result.ok) {
        return null;
      }
      const preview = calculateOrderPricing({
        config: pricingConfig,
        deliveryFee,
        discount: result.discount,
        items,
        tip,
      });
      if (preview.discount <= 0) {
        return null;
      }
      return { code: promoCode.code, discount: preview.discount, type: promoCode.type };
    })
    .filter((offer): offer is { code: string; discount: number; type: string } => offer !== null);

  return json(200, {
    data: {
      applied: resolved
        ? { code: resolved.code, fundingSource: resolved.discount.fundingSource, type: resolved.discount.type }
        : null,
      automaticOffers,
      code: code || null,
      discount: pricing.discount,
      deliveryFee: pricing.deliveryFee,
      // A manual code that validated but yields no discount for this basket.
      message: code && !resolved ? 'This code gives no discount on your current basket.' : null,
      subtotal: pricing.subtotal,
      tip: pricing.tip,
      total: pricing.total,
      valid: pricing.discount > 0,
    },
  });
};

const customerGetSupportThread: Handler = async ({ context }) => {
  const { data: conversation, error: convError } = await serviceClient
    .from('SupportConversation')
    .select('*')
    .eq('customerId', context.uid)
    .maybeSingle<SupportConversationRow>();
  if (convError) {
    throw new Error(convError.message);
  }
  if (!conversation) {
    return json(200, { data: { conversation: null, messages: [] } });
  }

  const { data: messages, error: msgError } = await serviceClient
    .from('SupportMessage')
    .select('*')
    .eq('conversationId', conversation.id)
    .order('createdAt', { ascending: true })
    .returns<SupportMessageRow[]>();
  if (msgError) {
    throw new Error(msgError.message);
  }
  return json(200, { data: { conversation, messages: messages ?? [] } });
};

export const ordersDomain = defineRpcDomain<AuthenticatedRequestContext>({
  actions: ORDER_ACTIONS,
  name: 'orders',
  handlers: {
    cancelCustomerOrder,
    customerGetOrderDetail,
    customerGetOrders,
    customerGetPendingRatings,
    customerGetSupportThread,
    customerListFavoriteRestaurants,
    customerSendSupportMessage,
    customerSubmitOrderRating,
    customerToggleFavoriteRestaurant,
    customerValidatePromoCode,
    initializeCustomerPayment,
    placeCustomerOrder,
    refreshCustomerPaymentStatus,
  },
});
