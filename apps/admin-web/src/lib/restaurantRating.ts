/**
 * How the admin console words a restaurant's rating.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE THREE STATES AND NOT TWO. This module was written while NO
 * admin payload carried `ratingAverage` or `ratingCount`: the columns were
 * being SELECTed by `RESTAURANT_COLUMNS` and then dropped one function later
 * by `buildRestaurantResponse`, the shared wire-shape builder both admin
 * restaurant reads map through. The builder now emits them and
 * `RestaurantDocument` declares them, so the normal path carries a real
 * figure.
 *
 * The `unavailable` state stays, because that failure is still reachable and
 * is invisible when it happens. A stale deployed edge function, an older
 * cached response, or a future projection that whitelists fields by hand all
 * produce a restaurant object with no rating keys -- and a summary that cannot
 * tell that apart from `ratingCount: 0` will calmly report "No ratings yet"
 * about a restaurant with two hundred of them. That is a worse lie than the
 * "0.0" this module already rules out, because it reads as a finding rather
 * than as a gap.
 *
 * Note the asymmetry that makes `unavailable` genuinely rare rather than
 * merely unlikely: the builder coalesces the count with `?? 0`, so an unrated
 * restaurant arrives as `ratingCount: 0`, not as null. A null or missing count
 * therefore means the payload is wrong, not that the restaurant is new.
 * ---------------------------------------------------------------------------
 *
 * ON THE STAR. The glyph is part of the returned string on purpose, so it
 * inherits the surrounding text colour. The console's brand orange
 * (--brand-orange) and soft green (--accent-soft) are fill-only tokens -- as a
 * line or a glyph they fail contrast on this palette's own surfaces, which is
 * what styles/fillOnlyColors.test.ts enforces. A star is text. Rendering it in
 * a fill token is the specific mistake that test exists to catch, and keeping
 * it inside the label means no caller has to remember.
 */

export type RestaurantRatingFields = {
  ratingAverage?: number | null;
  ratingCount?: number | null;
};

export type RestaurantRatingSummary = {
  /** The whole claim, as a sentence fragment. Never empty. */
  label: string;
  /** True only when there is a real average over a real count. */
  hasRatings: boolean;
  /**
   * True when the payload carried no rating fields at all. Distinct from
   * `hasRatings: false`, which is a positive statement that the restaurant has
   * not been rated. Callers should render this as an absence of information,
   * not as an absence of ratings.
   */
  unavailable: boolean;
};

const pluralRatings = (count: number) => `${count} ${count === 1 ? 'rating' : 'ratings'}`;

export const summarizeRestaurantRating = (restaurant: RestaurantRatingFields | null | undefined): RestaurantRatingSummary => {
  const rawCount = restaurant?.ratingCount;
  const rawAverage = restaurant?.ratingAverage;

  // `undefined` means the field never arrived; `null` is a value the column
  // genuinely holds for an unrated restaurant. Only the former is "unavailable".
  if (rawCount === undefined || rawCount === null) {
    return {
      label: 'Rating not available',
      hasRatings: false,
      unavailable: true,
    };
  }

  const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? Math.max(Math.trunc(rawCount), 0) : 0;

  if (count === 0) {
    // In words, never "0.0" and never an empty row of stars. No ratings is not
    // a bad rating, and a zero in a rating column reads as one.
    return { label: 'No ratings yet', hasRatings: false, unavailable: false };
  }

  if (typeof rawAverage !== 'number' || !Number.isFinite(rawAverage)) {
    // Count without an average means the two columns disagree -- the aggregate
    // is maintained by ebuy_submit_order_rating and they should move together.
    // Report the half that exists rather than suppressing both or printing 0.
    return {
      label: `${pluralRatings(count)}, average unavailable`,
      hasRatings: false,
      unavailable: false,
    };
  }

  // The count always travels with the average. 5.0 from one order and 4.6 from
  // two hundred are different facts about a restaurant, and an average shown
  // alone lets an operator read the first as the second.
  return {
    label: `${rawAverage.toFixed(1)} ★ from ${pluralRatings(count)}`,
    hasRatings: true,
    unavailable: false,
  };
};
