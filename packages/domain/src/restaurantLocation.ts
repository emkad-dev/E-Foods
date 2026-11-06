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
  'Find from address or Use my current location.';

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

export type RestaurantLocationState = {
  isPublished?: boolean | null;
  latitude?: unknown;
  longitude?: unknown;
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
 * A restaurant that is ALREADY published without coordinates is deliberately let
 * through: those rows pre-date this rule, hiding them is an operator decision,
 * and refusing every unrelated save on them (opening hours, fees) would strand
 * the owners. An unpublishing write is never refused.
 */
export const isPublishBlockedByLocation = (
  current: RestaurantLocationState | null | undefined,
  next: RestaurantLocationState
): boolean => {
  if (next.isPublished !== true) {
    return false;
  }

  if (isUsableCoordinatePair(next.latitude, next.longitude)) {
    return false;
  }

  const wasPublished = current?.isPublished === true;
  const hadLocation = isUsableCoordinatePair(current?.latitude, current?.longitude);

  return !wasPublished || hadLocation;
};
