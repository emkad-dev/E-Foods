/**
 * Trip decisions for the rider's mini map: which way the rider is heading,
 * where "Navigate" should send them, and which of their orders to show first.
 *
 * Pure and IO-free (explicit `.ts` specifiers so it loads under
 * `node --test --experimental-strip-types`), so the "never send a rider to the
 * wrong place" rules are unit-tested without a device.
 */
import type { OrderDocument } from './entities.ts';
import { normalizeOrderStatus } from './orders.ts';

export type TripLeg = 'to_restaurant' | 'to_customer';

export type MapPoint = { latitude: number; longitude: number };

export type NavigateTarget = { kind: 'directions'; url: string } | { kind: 'search'; url: string };

const hasValue = (value: unknown) => value !== null && value !== undefined && value !== '';

/**
 * Before pickup the next stop is the restaurant, after pickup the customer.
 * `escalated` is neither: the order keeps its place in the flow, so only the
 * pickup stamp can say which side of it the rider is on, and without one we
 * return null rather than guess (the Navigate button hides).
 */
export const getTripLeg = (order: OrderDocument): TripLeg | null => {
  if (order.fulfillmentType === 'pickup') {
    return null;
  }

  switch (normalizeOrderStatus(order.status)) {
    case 'accepted':
    case 'preparing':
    case 'ready_for_pickup':
      return 'to_restaurant';
    case 'picked_up':
    case 'on_the_way':
      return 'to_customer';
    case 'escalated':
      return hasValue(order.timeline?.pickedUpAt) ? 'to_customer' : null;
    default:
      // Terminal states, plus draft/scheduled/placed where no rider is on the order yet.
      return null;
  }
};

// Finite numbers only, matching the customer order screen: a coordinate that
// arrived as a string is treated as missing rather than silently parsed.
const toPoint = (latitude: unknown, longitude: unknown): MapPoint | null =>
  typeof latitude === 'number' &&
  Number.isFinite(latitude) &&
  typeof longitude === 'number' &&
  Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;

export const getRestaurantPoint = (order: OrderDocument): MapPoint | null =>
  toPoint(order.restaurantLatitude, order.restaurantLongitude);

export const getDropoffPoint = (order: OrderDocument): MapPoint | null =>
  toPoint(order.deliveryLocation?.latitude, order.deliveryLocation?.longitude);

export const buildDirectionsUrl = (point: MapPoint) =>
  `https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}&travelmode=driving`;

export const buildPlaceSearchUrl = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

export const getNavigateTarget = (order: OrderDocument): NavigateTarget | null => {
  const leg = getTripLeg(order);

  if (leg === 'to_customer') {
    const dropoff = getDropoffPoint(order);
    return dropoff ? { kind: 'directions', url: buildDirectionsUrl(dropoff) } : null;
  }

  if (leg === 'to_restaurant') {
    const restaurant = getRestaurantPoint(order);
    if (restaurant) {
      return { kind: 'directions', url: buildDirectionsUrl(restaurant) };
    }
    // Snapshots from a server that predates restaurant coordinates still name
    // the restaurant, and Maps can find it by name.
    const name = typeof order.restaurantName === 'string' ? order.restaurantName.trim() : '';
    return name ? { kind: 'search', url: buildPlaceSearchUrl(name) } : null;
  }

  return null;
};

// Furthest along first: the order in the rider's hands matters more than one
// still being cooked.
const URGENCY: readonly string[] = [
  'on_the_way',
  'picked_up',
  'escalated',
  'ready_for_pickup',
  'preparing',
  'accepted',
];

export const pickActiveDeliveries = (
  orders: readonly OrderDocument[],
  riderUid: string | null | undefined,
): OrderDocument[] => {
  if (!riderUid) {
    return [];
  }

  return orders
    .filter((order) => order.assignment?.courierId === riderUid && getTripLeg(order) !== null)
    .map((order, index) => ({ order, index, rank: URGENCY.indexOf(normalizeOrderStatus(order.status)) }))
    // Array.prototype.sort is stable, but the explicit index keeps ties in input order without relying on it.
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ order }) => order);
};
