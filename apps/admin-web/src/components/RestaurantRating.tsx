import { summarizeRestaurantRating, type RestaurantRatingFields } from '../lib/restaurantRating';

/**
 * A restaurant's customer rating, for the operator deciding whether to keep it
 * published. One component so the three states stay visually distinct at every
 * site that shows a restaurant -- see lib/restaurantRating.ts for the wording
 * rules and why "unrated" and "not supplied" are different facts.
 *
 * WHY ONLY THE RATED CASE GETS A BADGE. A badge in this console reads as a
 * figure worth scanning. "No ratings yet" is not a figure, and dressing it as
 * one puts an absence of evidence in the same visual slot as a score -- which
 * is the "no ratings is not a bad rating" rule losing to the styling. So a
 * real score is a badge and the other two states are plain muted text.
 *
 * THE STAR IS TEXT. It arrives inside the label string from
 * summarizeRestaurantRating, so it inherits whatever colour the surrounding
 * rule sets -- here `--text-soft` via .badge-neutral, a writing token measured
 * at 5.57:1 on --surface-muted. It is deliberately NOT given a colour of its
 * own: the console's star-ish tokens (--brand-orange, --accent-soft) are
 * fill-only and fail contrast as a glyph, which styles/fillOnlyColors.test.ts
 * exists to catch.
 */
export default function RestaurantRating({ restaurant }: { restaurant: RestaurantRatingFields | null | undefined }) {
  const summary = summarizeRestaurantRating(restaurant);

  if (summary.hasRatings) {
    return <span className="badge badge-neutral">{summary.label}</span>;
  }

  return (
    <span
      className="restaurant-rating-absent"
      // Only the `unavailable` branch gets an explanation, because only that
      // one is about this console rather than about the restaurant. It should
      // now be rare -- buildRestaurantResponse emits both fields and coalesces
      // the count to 0 -- so if an operator sees it, the most likely cause is
      // a stale deployed function, and the tooltip should say so rather than
      // leaving them to read it as "unrated".
      title={
        summary.unavailable
          ? 'This admin response did not include rating fields. The restaurant may well be rated; the payload did not say.'
          : undefined
      }
    >
      {summary.label}
    </span>
  );
}
