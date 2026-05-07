import { httpsCallable } from 'firebase/functions';
import type { OrderDocument, RestaurantDocument } from '../domain/entities';
import { functions } from './firebase/config';

type PartnerRestaurantContext = {
  claimableRestaurants: RestaurantDocument[];
  requiresVerifiedLink: boolean;
  restaurant: RestaurantDocument | null;
  restaurants: RestaurantDocument[];
};

const partnerGetRestaurantContextCallable = httpsCallable<Record<string, never>, PartnerRestaurantContext>(
  functions,
  'partnerGetRestaurantContext'
);

const partnerGetRestaurantOrdersCallable = httpsCallable<
  Record<string, never>,
  { orders: OrderDocument[]; restaurant: RestaurantDocument | null }
>(functions, 'partnerGetRestaurantOrders');

const partnerGetRestaurantOrderCallable = httpsCallable<{ orderId: string }, { order: OrderDocument }>(
  functions,
  'partnerGetRestaurantOrder'
);

export const getPartnerRestaurantContext = async () => {
  const result = await partnerGetRestaurantContextCallable({});
  return result.data;
};

export const getPartnerRestaurantOrders = async () => {
  const result = await partnerGetRestaurantOrdersCallable({});
  return result.data;
};

export const getPartnerRestaurantOrder = async (orderId: string) => {
  const result = await partnerGetRestaurantOrderCallable({ orderId });
  return result.data;
};
