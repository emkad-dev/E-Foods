import type { AddressRecord } from '../domain/entities.ts';
import { extractCoordinatePoint } from './restaurantAvailability.ts';

export type UsablePoint = { latitude: number; longitude: number };

/**
 * A real-world coordinate we can measure from.
 *
 * Rejects exactly 0N 0E: a missing pin that went through Number(null) used to
 * land customers there (see getRestaurantAvailability), and no restaurant or
 * customer is in the Gulf of Guinea, so (0, 0) always means "unset".
 */
export const toUsablePoint = (value: unknown): UsablePoint | null => {
  const point = extractCoordinatePoint(value);
  if (!point) {
    return null;
  }

  const { latitude, longitude } = point;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  if (latitude === 0 && longitude === 0) {
    return null;
  }

  return { latitude, longitude };
};

export const getUsableAddressPoint = (location: AddressRecord | null | undefined): UsablePoint | null =>
  location ? toUsablePoint({ latitude: location.latitude, longitude: location.longitude }) : null;

/**
 * Is there a saved address worth acting on?
 *
 * Yes when it has usable coordinates OR a non-blank typed address. A typed
 * address legitimately has null coordinates (app/onboarding.tsx stores it that
 * way and leaves geocoding to checkout), so it counts as saved; it simply
 * produces no distance warning.
 */
export const hasSavedAddress = (location: AddressRecord | null | undefined): boolean => {
  if (!location) {
    return false;
  }

  if (getUsableAddressPoint(location)) {
    return true;
  }

  return typeof location.address === 'string' && location.address.trim().length > 0;
};
