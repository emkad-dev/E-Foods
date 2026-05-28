import { callPartnerBackendRpc } from './backendRpc';

export type PartnerRestaurantProfileInput = {
  restaurantId?: string | null;
  userId: string;
  name: string;
  description?: string;
  image?: string;
  logoImage?: string;
  cuisine?: string;
  deliveryTime?: string;
  openingTime: string;
  closingTime: string;
  minOrder?: number | null;
  deliveryFee?: number | null;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  deliveryRadiusKm?: number | null;
  supportsPickup: boolean;
  supportsDelivery: boolean;
  isOpen: boolean;
};

export type PartnerMenuItemInput = {
  id: string;
  name: string;
  description: string;
  price: number;
  image?: string;
  categoryId?: string;
  categoryLabel?: string;
  isAvailable?: boolean;
};

export type PartnerMenuCategoryInput = {
  category: string;
  items: PartnerMenuItemInput[];
};

type PartnerRestaurantProfileResult = {
  id: string;
  name: string;
};

export const savePartnerRestaurantProfile = async (input: PartnerRestaurantProfileInput) =>
  callPartnerBackendRpc<PartnerRestaurantProfileResult>('upsertPartnerRestaurantProfile', input);

export const linkPartnerRestaurant = async (restaurantId: string) =>
  callPartnerBackendRpc<PartnerRestaurantProfileResult>('claimPartnerRestaurantLink', { restaurantId });

export const savePartnerRestaurantMenu = async (restaurantId: string, menu: PartnerMenuCategoryInput[]) => {
  await callPartnerBackendRpc('upsertPartnerRestaurantMenu', {
    menu,
    restaurantId,
  });
};
