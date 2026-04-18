import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase/config';

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
  isPublished: boolean;
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

export const savePartnerRestaurantProfile = async (input: PartnerRestaurantProfileInput) => {
  const restaurantRef = input.restaurantId
    ? doc(db, 'restaurants', input.restaurantId)
    : doc(collection(db, 'restaurants'));

  await setDoc(
    restaurantRef,
    {
      ownerId: input.userId,
      name: input.name.trim(),
      description: input.description?.trim() || '',
      image: input.image?.trim() || '',
      cuisine: input.cuisine?.trim() || '',
      deliveryTime: input.deliveryTime?.trim() || '',
      minOrder: input.minOrder ?? 0,
      deliveryFee: input.deliveryFee ?? 0,
      address: input.address?.trim() || '',
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      location:
        input.latitude !== null &&
        input.latitude !== undefined &&
        input.longitude !== null &&
        input.longitude !== undefined
          ? {
              latitude: input.latitude,
              longitude: input.longitude,
            }
          : null,
      deliveryRadiusKm: input.deliveryRadiusKm ?? null,
      supportsPickup: input.supportsPickup,
      supportsDelivery: input.supportsDelivery,
      isPublished: input.isPublished,
      isOpen: input.isOpen,
      updatedAt: serverTimestamp(),
      ...(input.restaurantId ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );

  return {
    id: restaurantRef.id,
    name: input.name.trim(),
  };
};

export const savePartnerRestaurantMenu = async (
  restaurantId: string,
  menu: PartnerMenuCategoryInput[],
  userId?: string
) => {
  await setDoc(
    doc(db, 'restaurants', restaurantId),
    {
      menu,
      ...(userId ? { ownerId: userId } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};
