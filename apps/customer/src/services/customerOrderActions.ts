import { httpsCallable } from 'firebase/functions';
import type { CartItem, DeliveryLocation } from '../contexts/CartContext';
import type { CheckoutPaymentMethod, FulfillmentType } from '../domain/orders';
import { functions } from './firebase/config';

export const PREPAID_CHECKOUT_DISABLED_MESSAGE =
  'Card and wallet payments are coming soon. Use cash for now while payment service is still being set up.';

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

const createIdempotencyKey = () =>
  `cust-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const placeCustomerOrder = async ({
  deliveryLocation,
  fulfillmentType,
  items,
  paymentMethod,
  restaurantId,
  tipAmount,
}: PlaceCustomerOrderInput): Promise<PlaceCustomerOrderResult> => {
  if (paymentMethod === 'card' || paymentMethod === 'wallet') {
    throw new Error(PREPAID_CHECKOUT_DISABLED_MESSAGE);
  }

  const callable = httpsCallable(functions, 'placeCustomerOrder');
  const result = await callable({
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

  return result.data as PlaceCustomerOrderResult;
};

type CancelCustomerOrderResult = {
  orderId: string;
  refundRate: number;
  status: string;
};

export const cancelCustomerOrder = async (orderId: string): Promise<CancelCustomerOrderResult> => {
  const callable = httpsCallable(functions, 'cancelCustomerOrder');
  const result = await callable({ orderId });
  return result.data as CancelCustomerOrderResult;
};
