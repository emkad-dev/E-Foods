import {
  ADMIN_RESTAURANT_LOCATION_REQUIRED_MESSAGE,
  ADMIN_RESTAURANT_OUTSIDE_NIGERIA_MESSAGE,
  restaurantLocationBlock,
} from '../../../../packages/domain/src/restaurantLocation.ts';

/**
 * Why Publish cannot succeed for this restaurant, or undefined when it can.
 *
 * Runs the same rule the server applies (`adminSetRestaurantPublished` calls
 * the shared restaurantLocationBlock), so the button is disabled exactly when
 * the server would answer 412. Before this, Publish on a restaurant with no pin
 * returned a refusal that rendered at the top of the page while the button sat
 * far below, so the click looked like it did nothing.
 */
export const publishBlockedReason = (restaurant: {
  isPublished?: boolean | null;
  latitude?: unknown;
  longitude?: unknown;
}): string | undefined => {
  const block = restaurantLocationBlock(restaurant, {
    isPublished: true,
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
  });

  if (block === 'missing') {
    return ADMIN_RESTAURANT_LOCATION_REQUIRED_MESSAGE;
  }

  if (block === 'outside-nigeria') {
    return ADMIN_RESTAURANT_OUTSIDE_NIGERIA_MESSAGE;
  }

  return undefined;
};

export const PARTNER_PAYOUT_MISSING_REASON =
  'No payout details on file. The partner must resubmit onboarding with a bank account before they can be approved.';

/**
 * Why partner Approve cannot succeed, or undefined when it can. The server
 * (resolvePayoutActivationPlan in _shared/partnerPayoutActivation.ts) refuses
 * an approval with 412 when the application has no payout row, and the review
 * block's `payout` is that row.
 */
export const partnerApproveBlockedReason = (application: {
  onboarding?: { payout?: unknown } | null;
}): string | undefined => (application.onboarding?.payout ? undefined : PARTNER_PAYOUT_MISSING_REASON);
