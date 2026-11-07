import type { AddressRecord } from '../domain/entities.ts';
import { calculateDistanceKm, extractRestaurantCoordinates, type DiscoveryRestaurant } from './restaurantAvailability.ts';
import { getUsableAddressPoint, toUsablePoint } from './savedAddress.ts';

/** Strictly more than this asks the customer to confirm. Exactly 50 does not. */
export const COLLECTION_WARNING_KM = 50;

export type CollectionDistanceWarning = {
  distanceKm: number;
  /** Whole kilometres, as shown to the customer. */
  displayKm: number;
  message: string;
};

export const formatCollectionDistanceMessage = (distanceKm: number) =>
  `This restaurant is ${Math.round(distanceKm)} km away. Are you sure?`;

/**
 * Warns before paying for COLLECTION when the restaurant is far from the saved
 * address. A warning, never a block.
 *
 * The cart holds one basket-wide fulfilment type (not one per restaurant), so
 * `collection` here is simply fulfilment === 'pickup' and every restaurant in
 * the basket counts. Mixed baskets use the farthest. Restaurants without usable
 * coordinates are ignored; with none usable, or an address that has none (a
 * typed address), there is nothing to measure and no warning.
 *
 * Note the display rounds to a whole km while the threshold does not: 50.4 km
 * warns and reads "50 km away".
 */
export const getCollectionDistanceWarning = (params: {
  fulfillmentType: 'delivery' | 'pickup';
  deliveryLocation: AddressRecord | null;
  restaurants: readonly (DiscoveryRestaurant | null | undefined)[];
}): CollectionDistanceWarning | null => {
  if (params.fulfillmentType !== 'pickup') {
    return null;
  }

  const origin = getUsableAddressPoint(params.deliveryLocation);
  if (!origin) {
    return null;
  }

  let farthestKm: number | null = null;
  for (const restaurant of params.restaurants) {
    if (!restaurant) {
      continue;
    }
    const point = toUsablePoint(extractRestaurantCoordinates(restaurant));
    if (!point) {
      continue;
    }
    const distanceKm = calculateDistanceKm(origin, point);
    if (farthestKm === null || distanceKm > farthestKm) {
      farthestKm = distanceKm;
    }
  }

  if (farthestKm === null || farthestKm <= COLLECTION_WARNING_KM) {
    return null;
  }

  return {
    distanceKm: farthestKm,
    displayKm: Math.round(farthestKm),
    message: formatCollectionDistanceMessage(farthestKm),
  };
};
