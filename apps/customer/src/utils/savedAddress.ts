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
 * Only when it has usable coordinates. Text alone is not an address: it cannot
 * be coverage-checked, measured for the collection warning, or found by a
 * rider. A text-only address saved by an older build therefore no longer counts,
 * so the launch prompt asks again and checkout asks for a pin once.
 */
export const hasSavedAddress = (location: AddressRecord | null | undefined): boolean =>
  getUsableAddressPoint(location) !== null;

/**
 * A typed address with no usable pin: what older builds saved from the launch
 * prompt. Kept as text (the customer wrote it) but the screens word their ask
 * as "confirm it on the map" rather than "add one", because the customer
 * already did add one.
 */
export const hasTextOnlyAddress = (location: AddressRecord | null | undefined): boolean =>
  Boolean(location) &&
  !hasSavedAddress(location) &&
  typeof location?.address === 'string' &&
  location.address.trim().length > 0;
