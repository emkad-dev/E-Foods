/**
 * The one sentence that explains `requiresVerifiedLink`.
 *
 * It was written twice - a paragraph on the Store tab, a near-identical one on
 * the account screen - and both described a condition the backend does not
 * have. They said the profile was "not explicitly linked yet", i.e. that
 * `linkedRestaurantId` was missing. It is the opposite: partnerGetRestaurantContext
 * (supabase/functions/_shared/domains/partner.ts) raises this flag only when
 * `UserAccount.restaurantId` IS set and does NOT resolve to the restaurant the
 * account manages - loadManagedRestaurantForUser returns the linked restaurant
 * whenever that id loads, so the two can only differ when the saved id points at
 * a RestaurantRecord that is not there, and the ownership fallback supplied a
 * different one. A dangling pin, not a missing one.
 *
 * Kept here rather than in either screen so the wrong version cannot survive in
 * the copy nobody edited.
 */
export const VERIFIED_LINK_MESSAGE =
  'This account is pinned to a restaurant ID that no longer exists, so it is falling back to the restaurant you own - confirm the link to pin it to the right one.';
