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
  isPublished?: boolean;
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
  // Preserved (not written by this screen's own full-form save) so a
  // full-menu re-upload — editing or removing a DIFFERENT item — never
  // silently clears a timed unavailability set via the lightweight
  // partnerSetMenuItemAvailability action.
  unavailableUntil?: string | null;
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

type SetMenuItemAvailabilityResult = {
  isAvailable: boolean;
  itemId: string;
  itemName: string;
  restaurantId: string;
  unavailableUntil: string | null;
};

// Task 16 (F2): the "two taps" action — flips a single item's availability
// without re-uploading the whole menu. `unavailableUntil` is only read when
// turning an item off; passing it while turning an item back on is ignored
// server-side (partnerSetMenuItemAvailability always clears it when
// isAvailable is true).
export const setPartnerMenuItemAvailability = async (input: {
  restaurantId: string;
  itemId: string;
  isAvailable: boolean;
  unavailableUntil?: string | null;
}) =>
  callPartnerBackendRpc<SetMenuItemAvailabilityResult>('partnerSetMenuItemAvailability', {
    isAvailable: input.isAvailable,
    itemId: input.itemId,
    restaurantId: input.restaurantId,
    unavailableUntil: input.unavailableUntil ?? null,
  });

type SetStorePauseResult = {
  paused: boolean;
  pausedUntil: string | null;
  restaurantId: string;
};

// Pausing always requires a future `pausedUntil` (no indefinite store
// pause); unpausing always clears it server-side regardless of what is sent.
export const setPartnerStorePause = async (input: {
  restaurantId: string;
  paused: boolean;
  pausedUntil?: string | null;
}) =>
  callPartnerBackendRpc<SetStorePauseResult>('partnerSetStorePause', {
    paused: input.paused,
    pausedUntil: input.pausedUntil ?? null,
    restaurantId: input.restaurantId,
  });
