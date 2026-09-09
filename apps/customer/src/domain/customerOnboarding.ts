/**
 * First-run onboarding gate for the customer app.
 *
 * WHY IT EXISTS. FEASTY lets people browse before signing in, but the feed is
 * location-aware: CoverageContext filters restaurants against the delivery
 * location, and until one is set a visitor sees an ungated list and only
 * discovers at checkout whether anyone can actually deliver to them. Asking for
 * the address first — the way every delivery app worth using does — makes the
 * first screen honest.
 *
 * WHY IT IS SKIPPABLE. It is a convenience, not a wall. A visitor who skips
 * still browses; they simply get the unfiltered feed, exactly as before this
 * existed. The gate therefore records that it was SHOWN, not that it was
 * satisfied — otherwise skipping would re-prompt on every launch, which is a
 * nag, not onboarding.
 *
 * Pure and IO-free: the AsyncStorage read lives in
 * services/customerOnboardingState.ts so this decision is unit-testable.
 */

export type CustomerOnboardingState = {
  /** True once the visitor has been shown the location step, skip included. */
  hasSeenLocationStep: boolean;
  /** True when a delivery location is already set (a returning visitor). */
  hasDeliveryLocation: boolean;
};

/**
 * Whether to route to the onboarding screen instead of the feed.
 *
 * A visitor who already has a delivery location never sees it, even if the
 * "seen" flag is missing — having an address IS the goal, so re-asking would be
 * pointless. That also means an existing user upgrading into this build is not
 * interrupted.
 */
export const shouldShowLocationOnboarding = ({
  hasDeliveryLocation,
  hasSeenLocationStep,
}: CustomerOnboardingState): boolean => {
  if (hasDeliveryLocation) {
    return false;
  }
  return !hasSeenLocationStep;
};

/**
 * Turns a reverse-geocoded address into the short label the header shows.
 * Falls back through the fuller address rather than rendering an empty chip.
 */
export const toLocationLabel = ({
  address,
  shortAddress,
}: {
  address?: string | null;
  shortAddress?: string | null;
}): string => {
  const short = (shortAddress ?? '').trim();
  if (short) {
    return short;
  }
  const full = (address ?? '').trim();
  if (!full) {
    return 'Set your location';
  }
  // A reverse geocode often returns "12 Admiralty Way, Lekki, Lagos, Nigeria".
  // The first two parts are the part a person recognises.
  return full.split(',').slice(0, 2).join(',').trim();
};
