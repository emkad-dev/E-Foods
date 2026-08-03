// Orders domain: the customer's own order lifecycle — browsing favourites,
// placing an order, paying for it, cancelling it, and the customer side of the
// support thread.
//
// The two security invariants that live here and must not move: the
// restaurant's own menu price is re-derived server-side and never accepted from
// the client, and the delivery-radius check runs here rather than trusting the
// app to have done it.

import { serviceClient } from '../client.ts';
import { isDeliveryOutOfRange } from '../deliveryCoverage.ts';
import { adjustDispatchRiderLoad, loadDispatchRiderSnapshot } from '../dispatchRiders.ts';
import {
  buildTransactionalEmailHtml,
  formatNairaAmount,
  sendTransactionalEmail,
  shortOrderCode,
} from '../email.ts';
import { buildNotificationData, notifyRestaurantUsers, notifySafely, notifyUsers } from '../notifications.ts';
import {
  CUSTOMER_ORDER_COLUMNS,
  DEFAULT_CURRENCY,
  insertDeliveryEvent,
  loadOrderBundle,
  loadOrderRelations,
  maybeExpireUnpaidOrder,
  normalizeOrderStatus,
  ORDER_STATUS,
  PAYMENT_PROVIDER_CASH,
  PAYMENT_PROVIDER_PAYSTACK,
  PAYMENT_STATUS,
  PAYSTACK_PAYMENT_METHODS,
  PREPAID_PAYMENT_METHODS,
  toOrderSnapshotResponse,
  updateOrderRecord,
  upsertPaymentTransaction,
  type CustomerOrderRow,
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
import { loadPricingConfig } from '../platformSettings.ts';
import { calculateOrderPricing, toDisplayPrice, type PricingConfig } from '../pricing.ts';
import { broadcastOrderChanged, broadcastSupportInboxChanged, broadcastSupportThreadChanged } from '../realtime.ts';
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
          isAvailable: itemRecord.isAvailable !== false,
          name: sanitizeText(itemRecord.name),
          price: parseNumber(itemRecord.price, Number.NaN),
        };
      })
      .filter((item) => item.id && item.name && Number.isFinite(item.price));
  });
};

const buildOrderItems = (
  requestedItems: unknown,
  restaurantId: string,
  restaurant: RestaurantRecordRow,
  pricingConfig: PricingConfig
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
    if (!menuItem || menuItem.isAvailable === false) {
      fail(412, 'One or more selected menu items are unavailable.');
    }

    // Restaurant's own price — settlement and min-order run on this.
    const basePrice = menuItem.price;

    return {
      basePrice,
      id: menuItem.id,
      name: menuItem.name,
      // Customer-facing price with the platform markup embedded, re-derived
      // server-side from the authoritative menu price (never client input).
      price: toDisplayPrice(basePrice, pricingConfig),
      quantity,
      restaurantId,
      restaurantName: sanitizeText(restaurant.name, 'Restaurant'),
    };
  });
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
  settlement = null,
}: {
  accessCode?: string | null;
  authorizationUrl?: string | null;
  paymentMethod: string;
  reference?: string | null;
  settlement?: JsonObject | null;
}) => {
  if (!PREPAID_PAYMENT_METHODS.has(paymentMethod)) {
    return {
      capturedAmount: 0,
      lastEvent: 'awaiting_cash_collection',
      method: paymentMethod,
      processor: PAYMENT_PROVIDER_CASH,
      reference: null,
      refundAmount: 0,
      refundedAt: null,
      paidAt: null,
      settlement,
      status: PAYMENT_STATUS.PENDING,
    };
  }

  return {
    accessCode,
    authorizationUrl,
    capturedAmount: 0,
    channel: paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'card',
    lastEvent: 'awaiting_customer_payment',
    method: paymentMethod,
    paidAt: null,
    processor: PAYMENT_PROVIDER_PAYSTACK,
    reference,
    refundAmount: 0,
    refundedAt: null,
    settlement,
    status: PAYMENT_STATUS.PENDING,
    verifiedAt: null,
  };
};

const prepareCustomerOrderDraft = async (
  requestData: Record<string, unknown>,
  allowedPaymentMethods: readonly string[]
) => {
  const restaurantId = sanitizeText(requestData.restaurantId);
  const fulfillmentType = sanitizeText(requestData.fulfillmentType, 'delivery');
  const paymentMethod = sanitizeText(requestData.paymentMethod, 'card');
  const idempotencyKey = sanitizeText(requestData.idempotencyKey);
  const tipAmount = roundCurrency(parseNumber(requestData.tipAmount, 0));

  if (!restaurantId) {
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

  if (fulfillmentType === 'delivery' && restaurant.supportsDelivery === false) {
    fail(412, 'This restaurant does not support delivery.');
  }

  if (fulfillmentType === 'pickup' && restaurant.supportsPickup === false) {
    fail(412, 'This restaurant does not support pickup.');
  }

  const pricingConfig = await loadPricingConfig();
  const items = buildOrderItems(requestData.items, restaurantId, restaurant, pricingConfig);
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

  const pricing = calculateOrderPricing({
    config: pricingConfig,
    deliveryFee,
    items,
    tip: tipAmount,
  });

  return {
    deliveryLocation,
    fulfillmentType,
    idempotencyKey,
    items,
    paymentMethod,
    pricing,
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
}) => {
  const createdAt = nowIso();
  const timeline = {
    placedAt: createdAt,
  };

  const orderInsert = {
    id: orderId,
    customerId,
    restaurantId,
    restaurantName,
    status: ORDER_STATUS.PLACED,
    fulfillmentType,
    pricing,
    payment,
    deliveryAddress: sanitizeOptionalText(deliveryLocation?.address),
    deliveryLocation,
    attributedPromoId: attributedPromoId ?? null,
    cancellation: null,
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
      price: item.price,
      quantity: item.quantity,
      restaurantId: item.restaurantId,
      restaurantName: item.restaurantName,
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

const buildRefundUpdate = ({
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
  if ([ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
    return 1;
  }

  if ([ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
    return 0.5;
  }

  return 0;
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

  let nextPayment: JsonObject = {
    ...existingPayment,
    accessCode: sanitizeOptionalText(existingPayment.accessCode),
    authorizationUrl: sanitizeOptionalText(existingPayment.authorizationUrl),
    method: paymentMethod,
    processor: PAYMENT_PROVIDER_PAYSTACK,
    reference: paymentReference,
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

  await updateOrderRecord(order.id, {
    payment: nextPayment,
    updatedAt: verifiedAtIso,
  });

  await upsertPaymentTransaction({
    orderId: order.id,
    customerId: order.customerId,
    restaurantId: order.restaurantId,
    provider: PAYMENT_PROVIDER_PAYSTACK,
    method: paymentMethod,
    reference: paymentReference,
    currency: DEFAULT_CURRENCY,
    amount: parseNumber((order.pricing ?? {}).total, 0),
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

  if (sanitizeText(nextPayment.status) === PAYMENT_STATUS.PAID) {
    await insertDeliveryEvent({
      orderId: order.id,
      eventType: 'payment_confirmed',
      actorUid: null,
      details: {
        amount: transactionAmount,
        provider: PAYMENT_PROVIDER_PAYSTACK,
        reference: paymentReference,
      },
    });
    await notifyRestaurantUsers(order.restaurantId, {
      title: 'Paid order received',
      body: `Order ${order.id.slice(-6).toUpperCase()} is paid and ready for confirmation.`,
      data: buildNotificationData({
        app: 'partner',
        orderId: order.id,
        routeKey: 'partner_order_detail',
        type: 'order_update',
      }),
    });
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
      'orderId,customerId,restaurantId,method,reference,status,accessCode,authorizationUrl,channel,gatewayStatus,lastError'
    )
    .eq('reference', paymentReference)
    .maybeSingle<PaymentTransactionRow>();

  if (paymentError) {
    throw new Error(paymentError.message);
  }

  const verifiedTransaction = await verifyPaystackTransaction(paymentReference);
  const expectedAmountKobo = toKoboAmount(parseNumber((order.pricing ?? {}).total, 0));
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

  return json(
    200,
    {
      data: {
        order: toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment, [], {
          ...riderSnapshot,
        }),
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

  const orderId = crypto.randomUUID();
  const payment = buildInitialPaymentSummary({
    paymentMethod: orderDraft.paymentMethod,
    settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
  });

  const orderCreation = await createOrderWithItems({
    customerId: context.uid,
    deliveryLocation: orderDraft.deliveryLocation,
    fulfillmentType: orderDraft.fulfillmentType,
    items: orderDraft.items,
    orderId,
    payment,
    pricing: orderDraft.pricing,
    restaurantId: orderDraft.restaurantId,
    restaurantName: sanitizeText(orderDraft.restaurant.name, 'Restaurant'),
  });

  await insertDeliveryEvent({
    orderId,
    eventType: 'order_placed',
    actorUid: context.uid,
    details: {
      fulfillmentType: orderDraft.fulfillmentType,
      paymentMethod: orderDraft.paymentMethod,
      total: orderDraft.pricing.total,
    },
  });

  const response = {
    orderId,
    paymentStatus: sanitizeText(payment.status, PAYMENT_STATUS.PENDING),
    status: ORDER_STATUS.PLACED,
    total: orderDraft.pricing.total,
  };

  if (idempotencyKey) {
    await storeIdempotencyRecord(idempotencyKey, 'place_customer_order', context.uid, response);
  }

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

  await notifySafely(async () => {
    const restaurantName = sanitizeText(orderDraft.restaurant.name, 'the restaurant');
    await sendTransactionalEmail({
      to: context.email,
      subject: `Order ${shortOrderCode(orderId)} placed`,
      html: buildTransactionalEmailHtml({
        heading: 'Your order has been placed',
        lines: [
          `We received your order ${shortOrderCode(orderId)} for ${restaurantName}.`,
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

  const orderId = crypto.randomUUID();
  const rawAttributedPromoId = sanitizeText(data.attributedPromoId);
  const attributedPromoId =
    rawAttributedPromoId && rawAttributedPromoId.length <= 128 ? rawAttributedPromoId : null;
  const paymentReference = buildPaystackReference(orderId, orderDraft.paymentMethod);
  const initialPayment = buildInitialPaymentSummary({
    paymentMethod: orderDraft.paymentMethod,
    reference: paymentReference,
    settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
  });

  const orderCreation = await createOrderWithItems({
    attributedPromoId,
    customerId: context.uid,
    deliveryLocation: orderDraft.deliveryLocation,
    fulfillmentType: orderDraft.fulfillmentType,
    items: orderDraft.items,
    orderId,
    payment: initialPayment,
    pricing: orderDraft.pricing,
    restaurantId: orderDraft.restaurantId,
    restaurantName: sanitizeText(orderDraft.restaurant.name, 'Restaurant'),
  });

  await upsertPaymentTransaction({
    orderId,
    customerId: context.uid,
    restaurantId: orderDraft.restaurantId,
    provider: PAYMENT_PROVIDER_PAYSTACK,
    method: orderDraft.paymentMethod,
    reference: paymentReference,
    currency: DEFAULT_CURRENCY,
    amount: orderDraft.pricing.total,
    status: PAYMENT_STATUS.PENDING,
  });

  try {
    const initializedTransaction = await initializePaystackTransaction({
      amount: orderDraft.pricing.total,
      email: context.email,
      paymentMethod: orderDraft.paymentMethod,
      reference: paymentReference,
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
      settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
    });

    await updateOrderRecord(orderId, {
      payment: paymentWithAuthorization,
      updatedAt: nowIso(),
    });

    await upsertPaymentTransaction({
      orderId,
      customerId: context.uid,
      restaurantId: orderDraft.restaurantId,
      provider: PAYMENT_PROVIDER_PAYSTACK,
      method: orderDraft.paymentMethod,
      reference: paymentReference,
      currency: DEFAULT_CURRENCY,
      amount: orderDraft.pricing.total,
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

    const response = {
      accessCode: sanitizeOptionalText(initializedTransaction.access_code),
      authorizationUrl: sanitizeText(initializedTransaction.authorization_url),
      orderId,
      paymentStatus: PAYMENT_STATUS.PENDING,
      publicKeyPresent: Boolean(getPaystackPublicKey()),
      reference: paymentReference,
      status: ORDER_STATUS.PLACED,
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

    await upsertPaymentTransaction({
      orderId,
      customerId: context.uid,
      restaurantId: orderDraft.restaurantId,
      provider: PAYMENT_PROVIDER_PAYSTACK,
      method: orderDraft.paymentMethod,
      reference: paymentReference,
      currency: DEFAULT_CURRENCY,
      amount: orderDraft.pricing.total,
      status: PAYMENT_STATUS.FAILED,
      lastError: paymentError instanceof Error ? paymentError.message : String(paymentError),
      failedAt: nowIso(),
    });

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
  // Cancellation is only allowed before the kitchen starts preparing.
  if (![ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
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

  await adjustDispatchRiderLoad(bundle.assignment?.courierId, -1);

  await insertDeliveryEvent({
    orderId,
    eventType: 'order_cancelled',
    actorUid: context.uid,
    details: {
      actorRole: context.role,
      refundRate,
    },
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
    customerGetSupportThread,
    customerListFavoriteRestaurants,
    customerSendSupportMessage,
    customerToggleFavoriteRestaurant,
    initializeCustomerPayment,
    placeCustomerOrder,
    refreshCustomerPaymentStatus,
  },
});
