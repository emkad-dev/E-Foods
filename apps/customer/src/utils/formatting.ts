/**
 * Display formatters shared across the customer screens.
 *
 * Pure and dependency-free so the rules can be unit-tested in plain Node: every
 * one of these existed as an inline copy on three-to-six screens, and the copies
 * had already drifted apart in ways a customer could see.
 */

/**
 * Naira amount for display: `₦4,300`, `₦4,300.50`, `₦0`.
 *
 * This used to be `₦${amount.toFixed(2)}`, which printed `₦4300.00` on every
 * price in the app — no thousands separator, and two kobo digits even when
 * the price was a whole naira amount, on every screen and in the store
 * screenshots. The partner app carries the same fix as `formatPartnerMoney`
 * in `apps/partner/src/utils/partnerQueue.ts`; the two are not shared because
 * the apps are separate bundles, but the rounding and grouping rules match.
 *
 * Kobo only appear when they are non-zero, and then always as two digits, so
 * an order total that carries the platform markup (which lands on a fraction
 * whenever the base price is not a multiple of 5) still reads exactly what
 * was charged.
 *
 * `amount` is widened past `number` on purpose. Five of the six inline copies
 * this replaces were typed `(amount: number)` and called `amount.toFixed(2)`
 * directly, which THROWS when the value is missing — and these values arrive
 * from RPC payloads where optional pricing fields (`serviceFee`, `tip`,
 * `refundAmount`) really can be absent. A missing, NaN, or infinite amount
 * renders as `₦0` instead of blanking the screen with a render error.
 *
 * Grouped by hand with a regex rather than `toLocaleString`/`Intl.NumberFormat`:
 * the output has to be identical on every phone, and under Hermes that
 * depends on locale data a given device ships. It also keeps this module
 * testable in plain Node.
 */
export const formatMoney = (amount: number | null | undefined): string => {
  const numeric = Number(amount ?? 0);
  const value = Number.isFinite(numeric) ? numeric : 0;
  // Round to kobo first so a sub-kobo value (e.g. 0.004) collapses to zero
  // before the sign/whole/fraction split below, rather than surviving as a
  // stray fractional kobo digit.
  const rounded = Math.round(value * 100) / 100;
  const magnitude = Math.abs(rounded);
  const naira = Math.floor(magnitude);
  const kobo = Math.round((magnitude - naira) * 100);
  const grouped = String(naira).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${rounded < 0 ? '-' : ''}₦${grouped}${kobo ? `.${String(kobo).padStart(2, '0')}` : ''}`;
};

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
