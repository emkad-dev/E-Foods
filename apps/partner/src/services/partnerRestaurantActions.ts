import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

export type PartnerRestaurantProfileInput = {
  restaurantId?: string | null;
  userId: string;
  name: string;
  description?: string;
  image?: string;
  cuisine?: string;
  deliveryTime?: string;
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

export const savePartnerRestaurantProfile = async (input: PartnerRestaurantProfileInput) => {
  const callable = httpsCallable(functions, 'upsertPartnerRestaurantProfile');
  const result = await callable(input);
  return result.data as PartnerRestaurantProfileResult;
};

export const linkPartnerRestaurant = async (restaurantId: string) => {
  const callable = httpsCallable(functions, 'claimPartnerRestaurantLink');
  const result = await callable({ restaurantId });
  return result.data as PartnerRestaurantProfileResult;
};

export const savePartnerRestaurantMenu = async (
  restaurantId: string,
  menu: PartnerMenuCategoryInput[]
) => {
  const callable = httpsCallable(functions, 'upsertPartnerRestaurantMenu');
  await callable({
    menu,
    restaurantId,
  });
};
