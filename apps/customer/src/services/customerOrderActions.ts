import type { CartItem, DeliveryLocation } from '../contexts/CartContext';
import type { CheckoutPaymentMethod, FulfillmentType } from '../domain/orders';
import { callCustomerBackendRpc } from './backendRpc';
import { clearCustomerReadCache } from './customerReadModel';
import { buildCustomerPaymentCallbackUrl } from './paymentRouting';
import { takeAttributedPromoId } from './promoTracking';
import { trackAnalyticsEvent } from '../../../../packages/observability/src/analytics';

export const PREPAID_CHECKOUT_DISABLED_MESSAGE =
  'Use card or bank transfer for checkout.';

type PlaceCustomerOrderInput = {
  deliveryLocation: DeliveryLocation | null;
  fulfillmentType: FulfillmentType;
  items: CartItem[];
  paymentMethod: CheckoutPaymentMethod;
  restaurantId: string;
  tipAmount: number;
};

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
  restaurantId,
  tipAmount,
}: PlaceCustomerOrderInput): Promise<InitializeCustomerPaymentResult> => {
  if (!['card', 'bank_transfer'].includes(paymentMethod)) {
    throw new Error(PREPAID_CHECKOUT_DISABLED_MESSAGE);
  }

  const attributedPromoId = takeAttributedPromoId();

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
