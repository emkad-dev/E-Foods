/**
 * The one rule for "does this restaurant have a usable location?", shared by the
 * edge functions (every path that publishes a restaurant) and the partner app
 * (the form that sets the coordinates), so the two cannot disagree about what
 * counts.
 *
 * Imports nothing: it runs under Deno, Node's test runner and Metro alike.
 */

export const RESTAURANT_LOCATION_REQUIRED_MESSAGE =
  "Set this restaurant's location before it can be published. Open Store details, choose Map location, and use " +
  'Use my current location or search for your address.';

/**
 * Said when the pin is a real coordinate but not in Nigeria. The usual cause is
 * latitude and longitude typed the wrong way round (Lagos is 6.5 N, 3.4 E), so
 * the owner is pointed at the two ways to fix it.
 */
export const RESTAURANT_OUTSIDE_NIGERIA_MESSAGE =
  'Your pin is outside Nigeria. Check the latitude and longitude, or use your current location.';

/** The admin cannot edit the pin, so the wording says who can. */
export const ADMIN_RESTAURANT_OUTSIDE_NIGERIA_MESSAGE =
  "This restaurant's pin is outside Nigeria, so it cannot be published. The owner must correct the latitude and longitude in Store details in the partner app.";

/** The wording for an admin, who cannot set the pin from the admin screen: the owner has to. */
export const ADMIN_RESTAURANT_LOCATION_REQUIRED_MESSAGE =
  'This restaurant has no location yet, so it cannot be published. The owner must set it in Store details in the partner app.';

/**
 * A coordinate counts as set only when it is a real, finite number. Strings are
 * NOT coerced: the column is DOUBLE PRECISION, so a string here means something
 * upstream mangled the value, and failing closed is the safe reading.
 */
const isUsableNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * True only for a latitude and longitude that are both present, finite and in
 * range, and not exactly 0,0. (0, 0) is open ocean in the Gulf of Guinea, not a
 * restaurant: an earlier bug saved typed addresses there when geocoding silently
 * produced nothing, so it is treated as "never set" rather than as a place.
 */
export const isUsableCoordinatePair = (latitude: unknown, longitude: unknown): boolean => {
  if (!isUsableNumber(latitude) || !isUsableNumber(longitude)) {
    return false;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return false;
  }

  return !(latitude === 0 && longitude === 0);
};

/**
 * A padded box around Nigeria, not its border: it exists to catch swapped
 * latitude/longitude, wrong signs and typos that land in another country or an
 * ocean, not to police the frontier. Inclusive on every edge.
 */
export const NIGERIA_BOUNDS = { minLatitude: 4.0, maxLatitude: 14.0, minLongitude: 2.5, maxLongitude: 15.0 } as const;

export const isInsideNigeria = (latitude: unknown, longitude: unknown): boolean =>
  isUsableCoordinatePair(latitude, longitude) &&
  (latitude as number) >= NIGERIA_BOUNDS.minLatitude &&
  (latitude as number) <= NIGERIA_BOUNDS.maxLatitude &&
  (longitude as number) >= NIGERIA_BOUNDS.minLongitude &&
  (longitude as number) <= NIGERIA_BOUNDS.maxLongitude;

export type RestaurantLocationState = {
  isPublished?: boolean | null;
  latitude?: unknown;
  longitude?: unknown;
};

export type RestaurantLocationBlock = 'missing' | 'outside-nigeria';

/**
 * Why the write is refused, or null when it is allowed, so each caller can word
 * the refusal. See isPublishBlockedByLocation for the rule.
 *
 * A pin outside Nigeria is refused when the row is going live (an unpublished
 * row holds whatever it likes until then) or when the write CHANGES the pin of a
 * row that is already live. An already-live row whose pin is unchanged still
 * saves, like the 0,0 rule: those pins pre-date this check and refusing every
 * unrelated save would strand the owner.
 */
export const restaurantLocationBlock = (
  current: RestaurantLocationState | null | undefined,
  next: RestaurantLocationState
): RestaurantLocationBlock | null => {
  if (next.isPublished !== true) {
    return null;
  }

  const wasPublished = current?.isPublished === true;

  if (isUsableCoordinatePair(next.latitude, next.longitude)) {
    if (isInsideNigeria(next.latitude, next.longitude)) {
      return null;
    }

    const changed = next.latitude !== current?.latitude || next.longitude !== current?.longitude;
    return !wasPublished || changed ? 'outside-nigeria' : null;
  }

  const sendsCoordinate = next.latitude != null || next.longitude != null;
  if (sendsCoordinate && (next.latitude !== current?.latitude || next.longitude !== current?.longitude)) {
    return 'missing';
  }

  const hadLocation = isUsableCoordinatePair(current?.latitude, current?.longitude);

  return !wasPublished || hadLocation ? 'missing' : null;
};

/**
 * Should a write that leaves the restaurant in the `next` state be refused?
 *
 * `current` is what the row holds NOW (null for a restaurant that does not exist
 * yet); `next` is what it will hold AFTER the write, so a save that clears the
 * coordinates is judged by the coordinates it leaves, not the ones it was sent.
 *
 * Only two things are refused:
 *   1. the transition into published without a usable location, and
 *   2. taking the location away from a published restaurant that has one.
 *
 * A write that puts an unusable non-null coordinate (0,0, out of range) on a
 * published row is refused when it CHANGES what the row holds, so an older
 * installed app cannot write a bad pin; an unchanged bad value still saves.
 *
 * A restaurant that is ALREADY published without coordinates is deliberately let
 * through: those rows pre-date this rule, hiding them is an operator decision,
 * and refusing every unrelated save on them (opening hours, fees) would strand
 * the owners. An unpublishing write is never refused.
 */
export const isPublishBlockedByLocation = (
  current: RestaurantLocationState | null | undefined,
  next: RestaurantLocationState
): boolean => restaurantLocationBlock(current, next) !== null;
