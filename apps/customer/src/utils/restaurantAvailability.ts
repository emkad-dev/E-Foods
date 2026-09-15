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

const hasKnownOperatingWindow = (restaurant: DiscoveryRestaurant) =>
  parseOperatingMinutes(restaurant.openingTime) !== null && parseOperatingMinutes(restaurant.closingTime) !== null;

const isInsideOperatingWindow = (restaurant: DiscoveryRestaurant, now = new Date()) => {
  const openingMinutes = parseOperatingMinutes(restaurant.openingTime);
  const closingMinutes = parseOperatingMinutes(restaurant.closingTime);

  // Fails open when the hours are unknown, and that is deliberate: a card from
  // customerGetRestaurantList carries no openingTime/closingTime at all (same
  // slimmed projection that drops `menu`), so hiding a restaurant we cannot
  // prove is shut would empty the feed on a data gap. What must NOT follow from
  // this is a screen printing "Open" off the back of it — that is a claim about
  // a window we never saw, and it is why the feed said Open while the detail
  // screen (which fetches the full record, hours included) said Closed. Use
  // getRestaurantOpenState when the question is what to TELL the customer.
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

  // A card from customerGetRestaurantList never carries a `menu` key at all
  // (undefined, not `[]`) — the edge function already excludes restaurants
  // with zero available items from that action, so there is nothing left to
  // check here. A full catalog entry (menu present, even `[]`, from the
  // deprecated getPublishedRestaurants or a single getRestaurantDetail) still
  // needs the real count, since neither of those pre-filters on it.
  if (restaurant.menu === undefined) {
    return true;
  }

  return getPublishedMenuItemCount(restaurant) > 0;
};

export const getRestaurantAvailability = (
  restaurant: DiscoveryRestaurant,
  deliveryLocation: AddressRecord | null,
  // Injectable so a caller that also asks getRestaurantOpenState a question
  // (getRestaurantCardStatusLabel does) can hold both to the same clock.
  // Callers pass nothing; only tests pin the time.
  now = new Date()
): RestaurantAvailability => {
  if (restaurant.isOpen === false) {
    return {
      isAvailable: false,
      reason: 'closed',
      distanceKm: null,
      radiusKm: null,
    };
  }

  if (!isInsideOperatingWindow(restaurant, now)) {
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
  // Read through extractCoordinatePoint, the same helper getPlatformCoverage
  // uses, rather than a bare Number(). Number(null) is 0 and 0 is finite, so
  // the old guard did NOT treat a missing pin as unknown: it placed the
  // customer at 0N 0E in the Gulf of Guinea and every restaurant with a sane
  // radius then reported "does not deliver to your pinned address". A typed
  // address is stored with null coordinates deliberately (app/onboarding.tsx
  // keeps the text and leaves geocoding to checkout), so this silently put
  // every customer who typed instead of sharing GPS out of range everywhere.
  const customerCoordinates = extractCoordinatePoint({
    latitude: deliveryLocation.latitude,
    longitude: deliveryLocation.longitude,
  });

  if (!restaurantCoordinates || !customerCoordinates) {
    return {
      isAvailable: true,
      reason: 'available',
      distanceKm: null,
      radiusKm: null,
    };
  }

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

/**
 * Decides, for the discovery feed, whether the restaurant shelf renders, what it
 * is called, and whether the empty state renders instead.
 *
 * WHY THIS EXISTS: the shelf and the empty state used to be guarded by two
 * unrelated predicates -- the shelf on `deliveryLocation`, the empty state on
 * `availableCount === 0`. A visitor with no pinned address and a non-empty
 * catalogue satisfied neither: the shelf was switched off, and the empty state
 * correctly decided the list was not empty. The screen rendered header chrome
 * and nothing else -- no restaurants, no message, no error. Skipping the
 * first-run location step (which is remembered, so it never re-prompts) landed
 * every visitor there permanently.
 *
 * Returning both flags from one function makes them complements by construction
 * rather than by coincidence, so "nothing on screen" and "nothing to show" can
 * never disagree again. The invariant is asserted in the tests.
 */
export const getDiscoverySections = (params: {
  availableCount: number;
  hasDeliveryLocation: boolean;
}) => {
  const showShelf = params.availableCount > 0;

  return {
    showShelf,
    // Never claim proximity without a location to be near: the feed is the same
    // list either way, and a heading that promises "near you" to someone who has
    // pinned nothing reads as broken the moment it is noticed.
    shelfTitle: params.hasDeliveryLocation ? 'Near your delivery point' : 'All restaurants',
    showEmptyState: !showShelf,
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

  // WHY THIS NO LONGER SAYS "we have not listed that yet": home filters the CARD
  // projection, which carries no `menu` (supabase/functions/public-catalog/
  // catalog.ts's toRestaurantCard emits no such key, on purpose, for bandwidth).
  // matchesRestaurantQuery therefore only ever compares a restaurant's name and
  // cuisine here, so typing a dish matched nothing and this copy told the
  // customer the dish did not exist — while the Search tab, which reads the full
  // catalogue meal-first, was serving it. Claim only what this filter actually
  // checked; home pairs this with a handoff to the meal search.
  if (normalizedQuery && params.matchedCount === 0) {
    return {
      title: 'No matching restaurants',
      copy: `No restaurant name or cuisine here matches "${params.query.trim()}" — but it may still be on a menu.`,
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

export type RestaurantOpenState = 'open' | 'closed' | 'unknown';

/**
 * Is this restaurant open right now — and do we actually know?
 *
 * WHY THE THIRD STATE: openness has two inputs, the partner's `isOpen` switch
 * and the operating window, and a card payload carries only the first. Every
 * card screen used to answer with a bare `isOpen === false ? 'Closed' : 'Open'`,
 * which silently promoted "no hours in this payload" to "open", so a restaurant
 * an hour past closing read Open on the feed and Closed on its own page. The
 * availability gate above still fails open on unknown hours (see
 * isInsideOperatingWindow — the alternative is hiding restaurants on a data
 * gap); what changes here is that 'unknown' is returned as itself, so a caller
 * can decline to make a claim instead of guessing in the customer's face.
 */
export const getRestaurantOpenState = (
  restaurant: DiscoveryRestaurant,
  now = new Date()
): RestaurantOpenState => {
  // The partner's own switch is authoritative and IS on every card, so a
  // deliberate "closed" is never downgraded to unknown.
  if (restaurant.isOpen === false) {
    return 'closed';
  }

  if (!hasKnownOperatingWindow(restaurant)) {
    return 'unknown';
  }

  return isInsideOperatingWindow(restaurant, now) ? 'open' : 'closed';
};

/**
 * The one status line a discovery card may show, or `null` when the honest
 * answer is "we cannot tell from this payload" and the card should say nothing.
 *
 * WHY IT IS SHARED: home, search and favorites each grew their own answer to
 * "can I order from this kitchen", and favorites' answer — a raw `isOpen`
 * read — knew nothing about operating hours, delivery range or pickup-only
 * partners, so the same restaurant could read three different ways in one
 * session. Every card surface routes through here instead.
 */
export const getRestaurantCardStatusLabel = (
  restaurant: DiscoveryRestaurant,
  availability: RestaurantAvailability,
  now = new Date()
): string | null => {
  switch (availability.reason) {
    case 'closed':
      return 'Closed';
    case 'out_of_area':
      return 'Out of area';
    case 'delivery_disabled':
      return 'Delivery unavailable';
    case 'pickup_only':
      return 'Pickup only';
    default:
      // Orderable as far as the gate can tell — but "Open" is a statement about
      // the operating window, so only say it when the window was actually read.
      return getRestaurantOpenState(restaurant, now) === 'open' ? 'Open' : null;
  }
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

// A restaurant with fewer than this many ratings shows "New" instead of an
// average — too few data points to be a trustworthy signal. This is a client
// display rule only: the server (public-catalog/catalog.ts's toRestaurantCard
// / toRestaurantDetail) never suppresses ratingAverage/ratingCount, it always
// emits the raw values.
export const NEW_RESTAURANT_RATING_THRESHOLD = 5;

/**
 * "New" below NEW_RESTAURANT_RATING_THRESHOLD ratings, otherwise the average
 * formatted to one decimal with the count in parentheses (e.g. "4.3 ★ (12)").
 * ratingAverage/ratingCount are optional on the type (older cached shapes,
 * legacy full-catalog rows) so both default safely to "no ratings yet".
 */
export const getRestaurantRatingLabel = (
  restaurant: Pick<DiscoveryRestaurant, 'ratingAverage' | 'ratingCount'>
): string => {
  const count = restaurant.ratingCount ?? 0;

  if (count < NEW_RESTAURANT_RATING_THRESHOLD) {
    return 'New';
  }

  const average = restaurant.ratingAverage ?? 0;
  return `${average.toFixed(1)} ★ (${count})`;
};

/**
 * The cuisine line a discovery card shows, or a stated placeholder when the
 * partner published none.
 *
 * WHY IT IS SHARED: the same line was spelled three ways across the card
 * surfaces -- "Kitchen update pending" on both home shelves, "Kitchen" on
 * favorites -- so one kitchen could introduce itself differently on two screens
 * of a single session.
 *
 * WHY IT TRIMS: every copy was `cuisine ?? '...'`, which only catches null and
 * undefined. `cuisine` arrives from a partner-edited text field, so an empty or
 * all-whitespace value is a real shape, and `??` passed it straight through --
 * rendering a BLANK line where the fallback was meant to be. Same defect
 * formatDeliveryEta documents for an all-whitespace ETA.
 */
export const getRestaurantCuisineLabel = (
  restaurant: Pick<DiscoveryRestaurant, 'cuisine'>
): string => restaurant.cuisine?.trim() || 'Kitchen update pending';

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
