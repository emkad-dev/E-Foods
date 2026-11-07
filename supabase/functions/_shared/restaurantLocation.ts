// The server half of "a restaurant needs a location before it can be published".
//
// EVERY write that can leave a RestaurantRecord published goes through this one
// helper, so the rule cannot be fixed on one path and forgotten on another. The
// rule itself (what a usable coordinate is, which transitions are refused) lives
// in packages/domain so the partner form that sets the coordinates reads the same
// definition.

import {
  RESTAURANT_LOCATION_REQUIRED_MESSAGE,
  isPublishBlockedByLocation,
  type RestaurantLocationState,
} from '../../../packages/domain/src/restaurantLocation.ts';
import { fail } from './rpc/respond.ts';

/**
 * Throws a 412 unless the write is allowed.
 *
 * `current` is the row as it is now (null when the restaurant does not exist yet)
 * and `next` is the row as the write will leave it - judge the resulting state,
 * not the request, so a save that clears the coordinates is caught. See
 * isPublishBlockedByLocation for exactly which transitions are refused and why an
 * already-published restaurant without coordinates is not one of them.
 */
export const assertRestaurantLocationAllowsPublish = (
  current: RestaurantLocationState | null | undefined,
  next: RestaurantLocationState,
  message: string = RESTAURANT_LOCATION_REQUIRED_MESSAGE
): void => {
  if (isPublishBlockedByLocation(current, next)) {
    fail(412, message);
  }
};
