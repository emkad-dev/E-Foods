import type { CartItem, DeliveryLocation } from '../contexts/CartContext';
import type { CheckoutPaymentMethod, FulfillmentType } from '../domain/orders';
import { callCustomerBackendRpc } from './backendRpc';

export const PREPAID_CHECKOUT_DISABLED_MESSAGE =
  'Wallet payments are still coming soon. Use card, bank transfer, or cash for now.';

type PlaceCustomerOrderInput = {
  deliveryLocation: DeliveryLocation | null;
  fulfillmentType: FulfillmentType;
  items: CartItem[];
  paymentMethod: CheckoutPaymentMethod;
  restaurantId: string;
  tipAmount: number;
};

type PlaceCustomerOrderResult = {
  orderId: string;
  paymentStatus: string;
  status: string;
  total: number;
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

export const placeCustomerOrder = async ({
  deliveryLocation,
  fulfillmentType,
  items,
  paymentMethod,
  restaurantId,
  tipAmount,
}: PlaceCustomerOrderInput): Promise<PlaceCustomerOrderResult> => {
  if (paymentMethod !== 'cash') {
    throw new Error(PREPAID_CHECKOUT_DISABLED_MESSAGE);
  }

  return callCustomerBackendRpc<PlaceCustomerOrderResult>('placeCustomerOrder', {
    deliveryLocation,
    fulfillmentType,
    idempotencyKey: createIdempotencyKey(),
    items: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
    })),
    paymentMethod,
    restaurantId,
    tipAmount,
  });
};

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

  return callCustomerBackendRpc<InitializeCustomerPaymentResult>('initializeCustomerPayment', {
    deliveryLocation,
    fulfillmentType,
    idempotencyKey: createIdempotencyKey(),
    items: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
    })),
    paymentMethod,
    restaurantId,
    tipAmount,
  });
};

type RefreshCustomerPaymentStatusResult = {
  gatewayStatus: string;
  orderId: string;
  paymentStatus: string;
  status: string;
};

export const refreshCustomerPaymentStatus = async (orderId: string): Promise<RefreshCustomerPaymentStatusResult> =>
  callCustomerBackendRpc<RefreshCustomerPaymentStatusResult>('refreshCustomerPaymentStatus', { orderId });

type CancelCustomerOrderResult = {
  orderId: string;
  refundRate: number;
  status: string;
};

export const cancelCustomerOrder = async (orderId: string): Promise<CancelCustomerOrderResult> =>
  callCustomerBackendRpc<CancelCustomerOrderResult>('cancelCustomerOrder', { orderId });
