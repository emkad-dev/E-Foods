/**
 * Display formatters shared across the customer screens.
 *
 * Pure and dependency-free so the rules can be unit-tested in plain Node: every
 * one of these existed as an inline copy on three-to-six screens, and the copies
 * had already drifted apart in ways a customer could see.
 */

/**
 * Naira amount for display.
 *
 * `amount` is widened past `number` on purpose. Five of the six inline copies
 * this replaces were typed `(amount: number)` and called `amount.toFixed(2)`
 * directly, which THROWS when the value is missing — and these values arrive
 * from RPC payloads where optional pricing fields (`serviceFee`, `tip`,
 * `refundAmount`) really can be absent. Only the search screen's copy coerced
 * first; that is the behaviour kept here, so a missing amount renders a zero
 * instead of blanking the screen with a render error.
 */
export const formatMoney = (amount: number | null | undefined): string =>
  `₦${Number(amount ?? 0).toFixed(2)}`;

/**
 * "3.4 km away".
 *
 * Callers must already have established that a distance exists — distance is
 * only known once the customer has pinned a delivery point AND the kitchen has
 * coordinates, so there is deliberately no fallback to invent here.
 */
export const formatDistanceAway = (distanceKm: number): string =>
  `${distanceKm.toFixed(1)} km away`;

/**
 * The partner's own delivery estimate, or `null` when they published none.
 *
 * Returning `null` rather than a fabricated window is the point. Three screens
 * used to substitute a literal "25-35 min" whenever `deliveryTime` was unset,
 * which meant every kitchen that had configured nothing quoted the customer the
 * same confident, invented delivery promise. That is the same defect class as
 * the guessed "Open" badge and the invented minimum-order figure: a claim the
 * app has no basis for, on a screen the customer plans around.
 *
 * `deliveryTime` is typed `string | number`, so a numeric value is stringified
 * exactly as the inline copies did. An all-whitespace value is treated as unset,
 * which the `??` copies did not do — they rendered a blank estimate.
 */
export const formatDeliveryEta = (
  deliveryTime: string | number | null | undefined
): string | null => {
  if (deliveryTime === null || deliveryTime === undefined) {
    return null;
  }

  const label = String(deliveryTime).trim();
  return label.length > 0 ? label : null;
};
