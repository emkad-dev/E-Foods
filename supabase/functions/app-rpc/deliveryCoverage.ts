/**
 * Delivery range enforcement for order creation.
 *
 * The 12km fallback for a non-positive radius mirrors getRestaurantServiceRadiusKm in
 * apps/customer/src/utils/restaurantAvailability.ts. The two MUST agree: if the server is
 * stricter, customers get 412s on orders the app told them were fine.
 */

const DEFAULT_DELIVERY_RADIUS_KM = 12;

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type DeliveryRangeInput = {
  restaurantLatitude: number | null | undefined;
  restaurantLongitude: number | null | undefined;
  deliveryLatitude: number | null | undefined;
  deliveryLongitude: number | null | undefined;
  deliveryRadiusKm: unknown;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

export const calculateDistanceKm = (origin: GeoPoint, target: GeoPoint) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(target.latitude - origin.latitude);
  const dLon = toRadians(target.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(target.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const resolveDeliveryRadiusKm = (configured: unknown) => {
  const parsed = toFiniteNumber(configured);
  return parsed !== null && parsed > 0 ? parsed : DEFAULT_DELIVERY_RADIUS_KM;
};

/**
 * True only when both sides have coordinates AND the delivery falls outside the radius.
 * Missing coordinates return false: never reject a legitimate order over absent data.
 */
export const isDeliveryOutOfRange = ({
  restaurantLatitude,
  restaurantLongitude,
  deliveryLatitude,
  deliveryLongitude,
  deliveryRadiusKm,
}: DeliveryRangeInput) => {
  const restaurantLat = toFiniteNumber(restaurantLatitude);
  const restaurantLon = toFiniteNumber(restaurantLongitude);
  const deliveryLat = toFiniteNumber(deliveryLatitude);
  const deliveryLon = toFiniteNumber(deliveryLongitude);

  if (restaurantLat === null || restaurantLon === null || deliveryLat === null || deliveryLon === null) {
    return false;
  }

  const distanceKm = calculateDistanceKm(
    { latitude: restaurantLat, longitude: restaurantLon },
    { latitude: deliveryLat, longitude: deliveryLon }
  );

  return distanceKm > resolveDeliveryRadiusKm(deliveryRadiusKm);
};
