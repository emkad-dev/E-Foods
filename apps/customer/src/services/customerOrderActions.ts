import type { CartItem, DeliveryLocation } from '../contexts/CartContext';
import type { CheckoutPaymentMethod, FulfillmentType } from '../domain/orders';
import { callCustomerBackendRpc } from './backendRpc';
import { clearCustomerReadCache } from './customerReadModel';
import { buildCustomerPaymentCallbackUrl } from './paymentRouting';
import { takeAttributedPromoId } from './promoTracking';
import { getStoredSessionId } from './session';
import { trackAnalyticsEvent } from '../../../../packages/observability/src/analytics';

export const PREPAID_CHECKOUT_DISABLED_MESSAGE =
  'Use card or bank transfer for checkout.';

type PlaceCustomerOrderInput = {
  deliveryLocation: DeliveryLocation | null;
  fulfillmentType: FulfillmentType;
  items: CartItem[];
  paymentMethod: CheckoutPaymentMethod;
  promoCode?: string | null;
  restaurantId: string;
  tipAmount: number;
};

export type PromoCodePreview = {
  applied: { code: string; fundingSource: string; type: string } | null;
  automaticOffers: { code: string; discount: number; type: string }[];
  code: string | null;
  discount: number;
  message: string | null;
  subtotal: number;
  total: number;
  valid: boolean;
};

// Advisory cart preview. The server re-validates and redeems at placement — this
// only shows the customer the discount before they pay, and is never trusted.
export const validateCustomerPromoCode = async ({
  fulfillmentType,
  items,
  promoCode,
  restaurantId,
  tipAmount,
}: {
  fulfillmentType: FulfillmentType;
  items: CartItem[];
  promoCode?: string | null;
  restaurantId: string;
  tipAmount: number;
}): Promise<PromoCodePreview> =>
  callCustomerBackendRpc<PromoCodePreview>('customerValidatePromoCode', {
    fulfillmentType,
    items: items.map((item) => ({ id: item.id, quantity: item.quantity })),
    restaurantId,
    tipAmount,
    ...(promoCode ? { promoCode } : {}),
  });

type InitializeCustomerPaymentResult = {
  accessCode?: string | null;
  authorizationUrl: string;
  orderId: string;
  paymentStatus: string;
  reference: string;
  status: string;
  total: number;
};

const createIdempotencyKey = () => `cust-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const initializeCustomerPayment = async ({
  deliveryLocation,
  fulfillmentType,
  items,
  paymentMethod,
  promoCode,
  restaurantId,
  tipAmount,
}: PlaceCustomerOrderInput): Promise<InitializeCustomerPaymentResult> => {
  if (!['card', 'bank_transfer'].includes(paymentMethod)) {
    throw new Error(PREPAID_CHECKOUT_DISABLED_MESSAGE);
  }

  const attributedPromoId = takeAttributedPromoId();
  const deviceSessionId = await getStoredSessionId().catch(() => null);

  return callCustomerBackendRpc<InitializeCustomerPaymentResult>('initializeCustomerPayment', {
    deliveryLocation,
    fulfillmentType,
    idempotencyKey: createIdempotencyKey(),
    items: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
    })),
    callbackUrl: buildCustomerPaymentCallbackUrl(),
    paymentMethod,
    restaurantId,
    tipAmount,
    deviceSessionId,
    // Server re-validates and redeems; the client's previewed discount is never trusted.
    ...(promoCode ? { promoCode } : {}),
    ...(attributedPromoId ? { attributedPromoId } : {}),
  }).then((result) => {
    clearCustomerReadCache();
    trackAnalyticsEvent('customer_payment_initialized', {
      fulfillment_type: fulfillmentType,
      items_count: items.length,
      payment_method: paymentMethod,
      restaurant_id: restaurantId,
      tip_amount: tipAmount,
      total: result.total,
    });
    return result;
  });
};

type RefreshCustomerPaymentStatusResult = {
  gatewayStatus: string;
  orderId: string;
  paymentStatus: string;
  status: string;
};

export const refreshCustomerPaymentStatus = async (orderId: string): Promise<RefreshCustomerPaymentStatusResult> =>
  callCustomerBackendRpc<RefreshCustomerPaymentStatusResult>('refreshCustomerPaymentStatus', { orderId }).then(
    (result) => {
      clearCustomerReadCache();
      trackAnalyticsEvent('customer_payment_status_refreshed', {
        order_id: orderId,
        payment_status: result.paymentStatus,
        status: result.status,
      });
      return result;
    }
  );

type CancelCustomerOrderResult = {
  orderId: string;
  refundRate: number;
  status: string;
};

export const cancelCustomerOrder = async (orderId: string): Promise<CancelCustomerOrderResult> =>
  callCustomerBackendRpc<CancelCustomerOrderResult>('cancelCustomerOrder', { orderId }).then((result) => {
    clearCustomerReadCache();
    trackAnalyticsEvent('customer_order_cancelled', {
      order_id: orderId,
      refund_rate: result.refundRate,
      status: result.status,
    });
    return result;
  });
