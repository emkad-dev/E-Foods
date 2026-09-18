/**
 * How a restaurant's ratings are WORDED and NUMBERED for the partner app.
 *
 * Pure on purpose: every decision here is one a reviewer can get wrong by eye
 * -- whether "4.96" may be shown as "5.0", whether a restaurant nobody has
 * rated has a score of 0.0, whether one rating and two hundred ratings make
 * the same claim. The screens import these; nothing about a rating is
 * formatted inline.
 *
 * WHAT IS NOT MODELLED HERE, deliberately: any link between a rating and the
 * customer or the order it came from. partnerGetRestaurantRatings withholds
 * `customerId` and `orderId` because a review the restaurant can attach to a
 * name -- on a platform where that name comes with a delivery address the
 * restaurant can read off the order -- is a retaliation surface. There is no
 * helper here to correlate one, and there should not be.
 */

/** The stored aggregate, as the backend reports it. */
export type RestaurantRatingSummary = {
  ratingAverage: number | null;
  ratingCount: number;
};

/** One customer's feedback, with nothing identifying attached. */
export type RestaurantRating = {
  id: string;
  restaurantScore: number;
  comment: string | null;
  createdAt: string;
};

export const RATING_SCALE_MAX = 5;

export const NO_RATINGS_VALUE = 'Not rated yet';
export const NO_RATINGS_HEADLINE = 'No ratings yet';
export const NO_RATINGS_DETAIL = 'Your first customer rating will show up here.';
/**
 * Said, rather than left blank. A rating with no comment is a score the
 * restaurant earned; an empty space under it reads as a rendering bug.
 */
export const NO_COMMENT_LABEL = 'Rated without a comment';
export const UNKNOWN_DATE_LABEL = 'Date unavailable';

/**
 * Narrows whatever the wire actually produced.
 *
 * Both fields are worth distrusting. `ratingAverage` is `number | null` in the
 * response type but arrives as JSON from a numeric column, so a string or a
 * NaN is representable; and the pair can disagree -- a stored average with a
 * zero count is not an average of anything. When they disagree the COUNT wins
 * and the average is dropped, because showing a score no customer gave is the
 * worse of the two failures.
 */
export const toRatingSummary = (
  source: { ratingAverage?: unknown; ratingCount?: unknown } | null | undefined
): RestaurantRatingSummary => {
  const rawCount = Number(source?.ratingCount);
  const ratingCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;

  if (ratingCount === 0) {
    return { ratingAverage: null, ratingCount: 0 };
  }

  const rawAverage = Number(source?.ratingAverage);
  const ratingAverage =
    Number.isFinite(rawAverage) && rawAverage > 0 ? Math.min(rawAverage, RATING_SCALE_MAX) : null;

  return { ratingAverage, ratingCount };
};

/**
 * One decimal, TRUNCATED -- never rounded up.
 *
 * The rounding question has a right answer here and it is not "nearest". A
 * displayed average is a claim the restaurant will repeat, and half-up turns
 * 4.96 into "5.0": a perfect score for a restaurant that does not have one.
 * Truncation can only ever understate, by at most 0.099, and it never invents
 * a milestone figure. So 4.25 shows as 4.2 (NOT 4.3), 4.96 shows as 4.9, and
 * only a genuine 5.0 prints 5.0.
 *
 * The `toFixed(6)` step is not decoration: 4.7 * 10 is 46.99999999999999 in
 * binary floating point, so a bare Math.floor would print 4.6 for an average
 * that is exactly 4.7.
 */
export const formatRatingAverage = (average: number): string => {
  const bounded = Math.min(Math.max(average, 0), RATING_SCALE_MAX);
  const truncated = Math.floor(Number((bounded * 10).toFixed(6))) / 10;
  return truncated.toFixed(1);
};

/** "1 rating" / "24 ratings" -- the denominator is never dropped. */
export const formatRatingCount = (count: number): string =>
  `${count} ${count === 1 ? 'rating' : 'ratings'}`;

/**
 * Filled stars for an average, FLOORED for the same reason the figure is
 * truncated: four and a half stars' worth of goodwill is not five stars.
 */
export const filledStarCount = (average: number | null): number => {
  if (average === null || !Number.isFinite(average)) {
    return 0;
  }

  const bounded = Math.min(Math.max(average, 0), RATING_SCALE_MAX);
  return Math.floor(Number(bounded.toFixed(6)));
};

/** A single rating's score, clamped to the scale and said in words. */
export const formatRatingScore = (score: number): string => {
  const bounded = Math.min(Math.max(Math.round(Number(score) || 0), 0), RATING_SCALE_MAX);
  return `${bounded} out of ${RATING_SCALE_MAX}`;
};

export type RatingSummaryCopy = {
  /** 'unrated' means there is no score to show -- NOT a score of zero. */
  state: 'unrated' | 'rated';
  /** Dashboard tile figure: '4.6', or words when there is nothing to average. */
  value: string;
  /** The denominator, always: 'From 24 ratings'. */
  detail: string;
  /** Screen header: '4.6 out of 5'. */
  headline: string;
  /** For the star row. Null when there is nothing to draw. */
  average: number | null;
};

/**
 * The 0 / 1 / many wording, in one place.
 *
 * ZERO IS NOT A SCORE. A restaurant nobody has rated yet must never render
 * "0.0" or an empty star row: both read as a bad rating rather than an absent
 * one, and the first is the worst thing this product could say about a partner
 * on their first day.
 *
 * THE COUNT IS ALWAYS PRESENT next to the figure. "5.0" from one delivery and
 * "4.6" from two hundred are different claims, and a tile that shows only the
 * first number invites the wrong one.
 */
export const describeRatingSummary = (summary: RestaurantRatingSummary): RatingSummaryCopy => {
  const { ratingAverage, ratingCount } = toRatingSummary(summary);

  if (ratingCount === 0 || ratingAverage === null) {
    return {
      state: 'unrated',
      value: NO_RATINGS_VALUE,
      detail: NO_RATINGS_DETAIL,
      headline: NO_RATINGS_HEADLINE,
      average: null,
    };
  }

  const value = formatRatingAverage(ratingAverage);

  return {
    state: 'rated',
    value,
    detail: `From ${formatRatingCount(ratingCount)}`,
    headline: `${value} out of ${RATING_SCALE_MAX}`,
    average: ratingAverage,
  };
};

/**
 * When a rating was left.
 *
 * `now` is a parameter so this is a pure function of its inputs rather than of
 * the clock. Day comparison runs in LOCAL time (both timestamps through the
 * same local-midnight reduction), which is what the partner reading the screen
 * means by "today".
 */
export const formatRatingDate = (iso: string, now: number = Date.now()): string => {
  const parsed = Date.parse(iso);

  if (!Number.isFinite(parsed)) {
    // A row we cannot date is still a rating. Printing "Invalid Date" next to
    // real feedback reads as a broken screen; the score still stands.
    return UNKNOWN_DATE_LABEL;
  }

  const startOfDay = (ms: number) => {
    const date = new Date(ms);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };

  const dayDelta = Math.round((startOfDay(now) - startOfDay(parsed)) / 86400000);

  // `<= 0` rather than `=== 0`: a row timestamped slightly in the future
  // (clock skew between the database and the device) is still "today", not a
  // negative number of days ago.
  if (dayDelta <= 0) {
    return 'Today';
  }

  if (dayDelta === 1) {
    return 'Yesterday';
  }

  return new Date(parsed).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

/**
 * Merges the next page into the list already on screen, by id.
 *
 * Offset paging over a table that is still being written to WILL hand back a
 * row that is already on screen: one new rating arrives between page 1 and
 * page 2, every row shifts down by one, and the last row of page 1 comes back
 * as the first row of page 2. Without this the partner sees the same comment
 * twice -- and React sees a duplicate key. Rows already on screen keep their
 * position; the new page keeps its own order.
 */
export const appendRatingsPage = (
  existing: RestaurantRating[],
  page: RestaurantRating[]
): RestaurantRating[] => {
  const seen = new Set(existing.map((rating) => rating.id));
  return [...existing, ...page.filter((rating) => !seen.has(rating.id))];
};
