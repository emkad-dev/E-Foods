import type { AddressRecord, RestaurantDocument } from '../domain/entities';

type CoordinatePoint = {
  latitude: number;
  longitude: number;
};

type CoordinateContainer = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};

export type DiscoveryRestaurant = Partial<RestaurantDocument> & {
  id: string;
  name: string;
  cuisine?: string | null;
  isPublished?: boolean | null;
  location?: CoordinateContainer | null;
  coordinates?: CoordinateContainer | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  menu?: {
    category: string;
    items: {
      categoryId?: string;
      categoryLabel?: string;
      id: string;
      isAvailable?: boolean;
      name: string;
      price: number;
    }[];
  }[] | null;
  serviceRadiusKm?: number | string | null;
  deliveryRadiusKm?: number | string | null;
  deliveryAreaKm?: number | string | null;
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type RestaurantAvailability = {
  isAvailable: boolean;
  reason: 'available' | 'pickup_only' | 'out_of_area' | 'delivery_disabled' | 'closed';
  distanceKm: number | null;
  radiusKm: number | null;
};

const DEFAULT_SERVICE_RADIUS_KM = 12;

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
};

const extractCoordinatePoint = (value: unknown): CoordinatePoint | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const coordinates = value as CoordinateContainer;
  const latitude = toNumber(coordinates.latitude ?? coordinates.lat);
  const longitude = toNumber(coordinates.longitude ?? coordinates.lng);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const parseOperatingMinutes = (value: string | null | undefined) => {
  if (!value || !TIME_PATTERN.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
};

const isInsideOperatingWindow = (restaurant: DiscoveryRestaurant, now = new Date()) => {
  const openingMinutes = parseOperatingMinutes(restaurant.openingTime);
  const closingMinutes = parseOperatingMinutes(restaurant.closingTime);

  if (openingMinutes === null || closingMinutes === null) {
    return true;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (openingMinutes === closingMinutes) {
    return true;
  }

  if (closingMinutes > openingMinutes) {
    return currentMinutes >= openingMinutes && currentMinutes < closingMinutes;
  }

  return currentMinutes >= openingMinutes || currentMinutes < closingMinutes;
};

const calculateDistanceKm = (origin: CoordinatePoint, destination: CoordinatePoint) => {
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(origin.latitude)) *
      Math.cos(toRadians(destination.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const normalizeRestaurantQuery = (query: string) => query.trim().toLowerCase();

export const matchesRestaurantQuery = (restaurant: DiscoveryRestaurant, query: string) => {
  const normalizedQuery = normalizeRestaurantQuery(query);

  if (!normalizedQuery) {
    return true;
  }

  const haystacks = [
    restaurant.name,
    restaurant.cuisine ?? '',
    ...(restaurant.menu ?? []).map((category) => category.category ?? ''),
    ...(restaurant.menu ?? []).flatMap((category) =>
      (category.items ?? []).flatMap((item) => [item.name ?? '', item.categoryLabel ?? '', item.categoryId ?? ''])
    ),
  ];

  return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
};

export const extractRestaurantCoordinates = (restaurant: DiscoveryRestaurant): CoordinatePoint | null => {
  return (
    extractCoordinatePoint({
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
    }) ??
    extractCoordinatePoint(restaurant.location) ??
    extractCoordinatePoint(restaurant.coordinates)
  );
};

export const getRestaurantServiceRadiusKm = (restaurant: DiscoveryRestaurant) => {
  const configured =
    toNumber(restaurant.deliveryRadiusKm) ??
    toNumber(restaurant.serviceRadiusKm) ??
    toNumber(restaurant.deliveryAreaKm);

  // A non-positive radius (0 or negative, e.g. a partner that opted into delivery
  // but never set a range) must not make the restaurant undeliverable everywhere —
  // fall back to the default service radius.
  return configured !== null && configured > 0 ? configured : DEFAULT_SERVICE_RADIUS_KM;
};

const getPublishedMenuItemCount = (restaurant: DiscoveryRestaurant) =>
  (restaurant.menu ?? []).reduce(
    (sum, category) => sum + category.items.filter((item) => item.isAvailable !== false).length,
    0
  );

export const isRestaurantVisibleToCustomers = (restaurant: DiscoveryRestaurant) => {
  if (!restaurant.name?.trim()) {
    return false;
  }

  if (restaurant.isPublished !== true) {
    return false;
  }

  return getPublishedMenuItemCount(restaurant) > 0;
};

export const getRestaurantAvailability = (
  restaurant: DiscoveryRestaurant,
  deliveryLocation: AddressRecord | null
): RestaurantAvailability => {
  if (restaurant.isOpen === false) {
    return {
      isAvailable: false,
      reason: 'closed',
      distanceKm: null,
      radiusKm: null,
    };
  }

  if (!isInsideOperatingWindow(restaurant)) {
    return {
      isAvailable: false,
      reason: 'closed',
      distanceKm: null,
      radiusKm: null,
    };
  }

  if (restaurant.supportsDelivery === false && restaurant.supportsPickup !== false) {
    return {
      isAvailable: true,
      reason: 'pickup_only',
      distanceKm: null,
      radiusKm: null,
    };
  }

  if (restaurant.supportsDelivery === false) {
    return {
      isAvailable: false,
      reason: 'delivery_disabled',
      distanceKm: null,
      radiusKm: null,
    };
  }

  if (!deliveryLocation) {
    return {
      isAvailable: true,
      reason: 'available',
      distanceKm: null,
      radiusKm: null,
    };
  }

  const restaurantCoordinates = extractRestaurantCoordinates(restaurant);
  const latitude = Number(deliveryLocation.latitude);
  const longitude = Number(deliveryLocation.longitude);

  if (!restaurantCoordinates || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {
      isAvailable: true,
      reason: 'available',
      distanceKm: null,
      radiusKm: null,
    };
  }

  const customerCoordinates = {
    latitude,
    longitude,
  };
  const distanceKm = calculateDistanceKm(restaurantCoordinates, customerCoordinates);
  const radiusKm = getRestaurantServiceRadiusKm(restaurant);

  if (distanceKm > radiusKm) {
    return {
      isAvailable: false,
      reason: 'out_of_area',
      distanceKm,
      radiusKm,
    };
  }

  return {
    isAvailable: true,
    reason: 'available',
    distanceKm,
    radiusKm,
  };
};

export const getDiscoveryEmptyState = (params: {
  availableCount: number;
  matchedCount: number;
  unavailableReasons: RestaurantAvailability['reason'][];
  query: string;
  unavailableCount: number;
  deliveryLocation: AddressRecord | null;
}) => {
  const normalizedQuery = normalizeRestaurantQuery(params.query);

  if (normalizedQuery && params.matchedCount === 0) {
    return {
      title: 'Coming soon',
      copy: `We have not listed "${params.query.trim()}" yet, but more cuisines and categories are on the way.`,
    };
  }

  const hasClosedRestaurants = params.unavailableReasons.includes('closed');
  const allUnavailableAreClosed =
    params.unavailableReasons.length > 0 && params.unavailableReasons.every((reason) => reason === 'closed');

  if (params.availableCount === 0 && params.unavailableCount > 0 && allUnavailableAreClosed) {
    return {
      title: 'Closed right now',
      copy: 'These restaurants are published, but they are currently closed. Check back again soon.',
    };
  }

  if (params.deliveryLocation && params.matchedCount > 0 && params.availableCount === 0 && params.unavailableCount > 0) {
    return {
      title: 'Not available in your area',
      copy: hasClosedRestaurants
        ? 'We found matching restaurants, but they are currently closed or outside the delivery range for this pinned location.'
        : 'We found matching restaurants, but they are outside the delivery range for this pinned location.',
    };
  }

  return {
    title: 'No restaurants found',
    copy: normalizedQuery
      ? 'Try another food, restaurant name, cuisine, or category.'
      : 'Restaurant listings will appear here once partners are available.',
  };
};

export const getRestaurantAvailabilityBadge = (availability: RestaurantAvailability) => {
  if (availability.reason === 'pickup_only') {
    return 'Pickup only';
  }

  if (availability.reason === 'closed') {
    return 'Closed';
  }

  return null;
};

export const getRestaurantOperatingHoursLabel = (restaurant: DiscoveryRestaurant) => {
  const openingTime = restaurant.openingTime?.trim();
  const closingTime = restaurant.closingTime?.trim();

  if (!openingTime || !closingTime) {
    return null;
  }

  return `${openingTime} - ${closingTime}`;
};

export type PlatformCoverage = {
  isCovered: boolean;
  nearestOrderableKm: number | null;
};

/**
 * Platform-level coverage: is FEASTY live where this customer pinned their address?
 *
 * Derived from the published catalogue, never configured — onboarding an orderable
 * (delivery- or pickup-capable) partner in a new area opens that area automatically.
 * Distinct from getRestaurantAvailability, which answers the narrower "can this one
 * restaurant serve this one order".
 *
 * Coverage counts a restaurant as a candidate when it is visible to customers, has
 * coordinates, and is orderable in some form — supports delivery OR pickup. This platform
 * is pickup-first by design (self-provisioned delivery is opt-in), so a pickup-only
 * restaurant must create coverage just like a delivery one. A restaurant is excluded only
 * when it explicitly opts out of both (`supportsDelivery === false && supportsPickup ===
 * false`).
 *
 * If zero candidates pass that eligibility filter — e.g. every published restaurant is
 * missing coordinates, which is the live production shape today — there is nothing to
 * check distance against, so coverage must fail open rather than block every customer
 * platform-wide.
 */
export const getPlatformCoverage = (
  restaurants: DiscoveryRestaurant[],
  deliveryLocation: AddressRecord | null
): PlatformCoverage => {
  const customerCoordinates = deliveryLocation
    ? extractCoordinatePoint({
        latitude: deliveryLocation.latitude,
        longitude: deliveryLocation.longitude,
      })
    : null;

  // Unknown location is never gated. The customer cannot reach delivery checkout without
  // pinning an address, and the server check is the real boundary.
  if (!customerCoordinates) {
    return { isCovered: true, nearestOrderableKm: null };
  }

  let eligibleCandidateCount = 0;
  let isCovered = false;
  let nearestOrderableKm: number | null = null;

  restaurants.forEach((restaurant) => {
    if (!isRestaurantVisibleToCustomers(restaurant)) {
      return;
    }

    if (restaurant.supportsDelivery === false && restaurant.supportsPickup === false) {
      return;
    }

    const restaurantCoordinates = extractRestaurantCoordinates(restaurant);
    if (!restaurantCoordinates) {
      return;
    }

    eligibleCandidateCount += 1;

    const distanceKm = calculateDistanceKm(restaurantCoordinates, customerCoordinates);

    if (nearestOrderableKm === null || distanceKm < nearestOrderableKm) {
      nearestOrderableKm = distanceKm;
    }

    if (distanceKm <= getRestaurantServiceRadiusKm(restaurant)) {
      isCovered = true;
    }
  });

  // No eligible candidates means there is nothing to gate against — fail open rather than
  // block every customer platform-wide (the live 6-restaurant catalogue is exactly this
  // shape: zero published restaurants currently have coordinates AND are delivery-only).
  if (eligibleCandidateCount === 0) {
    return { isCovered: true, nearestOrderableKm: null };
  }

  return { isCovered, nearestOrderableKm };
};
