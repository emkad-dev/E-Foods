/**
 * How a restaurant's rating is allowed to be stated to a customer.
 *
 * Pure on purpose, and in `domain/` rather than in a component, because every
 * hard decision here is a CLAIM about a business, not a layout question:
 * whether we may quote an average at all, how we round it, and how we name the
 * sample it came from. Those answers have to be identical on the home shelves,
 * favorites, search and the restaurant page, and they have to be testable under
 * `node --test` without Metro.
 *
 * The raw values arrive from the server untouched: public-catalog's
 * toRestaurantCard/toRestaurantDetail both emit `ratingAverage` (null when
 * nothing has been rated) and `ratingCount` (0), and the customer read model
 * passes the row through without remapping. Nothing is suppressed server-side,
 * so the display rule lives here and only here.
 */

/**
 * Structural so it accepts a `RestaurantDocument`, a `DiscoveryRestaurant`, or
 * a cached row from an older shape — all three reach the card surfaces. Both
 * fields are optional for that last reason: a payload cached before the rating
 * columns existed has neither, and it must degrade to "unrated", not to NaN.
 */
export type RatedRestaurant = {
  ratingAverage?: number | null;
  ratingCount?: number | null;
};

/** The word an unrated restaurant is presented with. */
export const UNRATED_LABEL = 'New';

/** The glyph. Exported so the component and the tests cannot drift on it. */
export const RATING_STAR = '★';

export type RestaurantRatingSummary =
  | {
      kind: 'unrated';
      /** "New" — never a number, never a star, never an empty string. */
      label: string;
      accessibilityLabel: string;
    }
  | {
      kind: 'rated';
      /** One decimal, already rounded. Always exactly three characters, e.g. "4.2". */
      average: string;
      count: number;
      /** Compact denominator for a card, e.g. "(12)". */
      countShort: string;
      /** Spoken denominator, e.g. "12 ratings" — singular at exactly one. */
      countLabel: string;
      accessibilityLabel: string;
    };

/**
 * Tolerance for the one-decimal truncation below.
 *
 * `4.2 * 10` is 42.000000000000006 in IEEE-754 and `3.3 * 10` is
 * 32.99999999999999. A bare `Math.floor` on the second would print 3.3 as
 * "3.2" — a restaurant marked down for a binary-representation artefact rather
 * than for its score. Anything within this of a tenth IS that tenth.
 */
const TENTH_EPSILON = 1e-9;

/** Scores are 1..5; anything outside that is corrupt data, not a rating. */
const MAX_SCORE = 5;

/**
 * One decimal place, rounding DOWN.
 *
 * THE DECISION: 4.25 renders "4.2", not "4.3". 4.96 renders "4.9", not "5.0".
 * Half-up rounding (what `toFixed(1)` does) is the obvious choice and the wrong
 * one here, because the error it makes is always in our favour and against the
 * reader: it lets a 4.96 restaurant advertise a perfect 5.0 it has not earned,
 * and a 4.96 and a true 5.0 then look identical in the feed. Truncating makes
 * the displayed number a floor — "at least this good" — so the printed figure
 * is never a stronger claim than the data supports. The cost is that a 4.99
 * shows 4.9; understating by a tenth is the failure we are willing to have.
 */
export const formatRatingAverage = (average: number): string => {
  const clamped = Math.min(Math.max(average, 0), MAX_SCORE);
  const scaled = clamped * 10;
  const nearest = Math.round(scaled);
  const tenths = Math.abs(scaled - nearest) < TENTH_EPSILON ? nearest : Math.floor(scaled);

  return (tenths / 10).toFixed(1);
};

/**
 * The denominator, spoken.
 *
 * Singular at exactly one, because "1 ratings" is the kind of seam that makes a
 * young restaurant's page look unfinished at the exact moment it is trying to
 * look credible.
 */
export const formatRatingCount = (count: number): string =>
  count === 1 ? '1 rating' : `${count} ratings`;

/**
 * What may be shown for this restaurant.
 *
 * TWO RULES THAT ARE NOT NEGOTIABLE:
 *
 * 1. A restaurant with no ratings is NOT a zero. It gets the word "New" — no
 *    number, no star, no empty gap. Rendering "0.0" or an unfilled star for an
 *    unrated kitchen states that customers rated it badly, which is both false
 *    and worse than what an actually badly-rated kitchen shows. "New" is the
 *    one presentation that is neutral and true.
 *
 * 2. The count always travels with the average. "5.0" from a single order and
 *    "4.6" from two hundred are different claims, and an average shown without
 *    its sample invites the reader to treat them as the same one. There is no
 *    caller-facing way to get the average without the count.
 *
 * `ratingAverage` missing while `ratingCount` is positive is treated as
 * unrated: that combination is corrupt rather than meaningful, and inventing a
 * number for it is exactly the claim this module exists to prevent.
 */
export const getRestaurantRatingSummary = (
  restaurant: RatedRestaurant
): RestaurantRatingSummary => {
  const count = restaurant.ratingCount ?? 0;
  const average = restaurant.ratingAverage;

  if (
    !Number.isFinite(count) ||
    count < 1 ||
    typeof average !== 'number' ||
    !Number.isFinite(average)
  ) {
    return {
      kind: 'unrated',
      label: UNRATED_LABEL,
      // Spelled out, because a screen reader announcing the bare word "New"
      // beside a restaurant name reads as a promotion, not as an absence.
      accessibilityLabel: 'New restaurant, not yet rated',
    };
  }

  const formattedAverage = formatRatingAverage(average);
  const countLabel = formatRatingCount(count);

  return {
    kind: 'rated',
    average: formattedAverage,
    count,
    countShort: `(${count})`,
    countLabel,
    accessibilityLabel: `Rated ${formattedAverage} out of 5 from ${countLabel}`,
  };
};
