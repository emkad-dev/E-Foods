import type { RestaurantRating, RestaurantRatingSummary } from '../domain/restaurantRatings';
import { callPartnerBackendRpc } from './backendRpc';

/**
 * One page of what customers said about this restaurant.
 *
 * `ratingAverage`/`ratingCount` are the STORED aggregate over every rating,
 * not a recomputation over the page -- so the header figure is right even
 * while only the first twenty rows are on screen.
 *
 * The row shape carries no `customerId` and no `orderId`. That is the
 * backend's deliberate omission (see partnerGetRestaurantRatings in
 * supabase/functions/_shared/domains/partner.ts), and it is repeated here so
 * that nothing on this side of the wire is tempted to join a review back to
 * the person who left it: the restaurant can read a delivery address off its
 * own order list, which would turn a one-star review into a retaliation
 * surface. Do not add either field to this type.
 */
export type PartnerRestaurantRatingsPage = RestaurantRatingSummary & {
  ratings: RestaurantRating[];
  hasMore: boolean;
};

/** Matches the backend default. */
export const PARTNER_RATINGS_PAGE_SIZE = 20;

/**
 * Both bounds are enforced server-side too (clamped to 1..50 / >= 0); sending
 * a value the server would have to correct just wastes the round trip.
 */
export const getPartnerRestaurantRatings = async (
  input: { limit?: number; offset?: number } = {}
) =>
  callPartnerBackendRpc<PartnerRestaurantRatingsPage>('partnerGetRestaurantRatings', {
    limit: Math.min(Math.max(input.limit ?? PARTNER_RATINGS_PAGE_SIZE, 1), 50),
    offset: Math.max(input.offset ?? 0, 0),
  });
