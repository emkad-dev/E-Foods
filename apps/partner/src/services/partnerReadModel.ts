import type { OrderDocument, RestaurantDocument } from '../domain/entities';
import { callPartnerBackendRpc } from './backendRpc';

type PartnerRestaurantContext = {
  claimableRestaurants: RestaurantDocument[];
  requiresVerifiedLink: boolean;
  restaurant: RestaurantDocument | null;
  restaurants: RestaurantDocument[];
};

export const getPartnerRestaurantContext = async () =>
  callPartnerBackendRpc<PartnerRestaurantContext>('partnerGetRestaurantContext');

export const getPartnerRestaurantOrders = async () =>
  callPartnerBackendRpc<{ orders: OrderDocument[]; restaurant: RestaurantDocument | null }>('partnerGetRestaurantOrders');

export const getPartnerRestaurantOrder = async (orderId: string) =>
  callPartnerBackendRpc<{ order: OrderDocument }>('partnerGetRestaurantOrder', { orderId });
