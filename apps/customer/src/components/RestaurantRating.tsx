import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { radius } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';
import { getRestaurantRatingSummary, RATING_STAR, type RatedRestaurant } from '../domain/restaurantRating';

/**
 * The one way a restaurant's rating is drawn anywhere a customer is choosing
 * one: both home shelves, favorites, search results and the restaurant page.
 *
 * WHY A COMPONENT AND NOT A STRING: the previous helper returned a single
 * formatted string, so the star glyph inherited whatever colour the call site's
 * label happened to use and the count had no typographic separation from the
 * average. A star IS text, so it needs a colour that clears contrast on the
 * surface it lands on; that is one decision and it belongs in one file. The
 * numbers, the wording and the rounding come from domain/restaurantRating.ts —
 * this file only draws them.
 *
 * WHY IT NEVER RENDERS NOTHING: an unrated restaurant renders the word "New",
 * not an empty slot. These cards sit in a scrolling feed, and a line that
 * appears for some restaurants and not others gives the feed two card heights
 * and makes it jump as rated and unrated kitchens interleave. Both states are
 * one line of the same fixed height, so the rating can never move the layout.
 */
export type RestaurantRatingVariant = 'card' | 'pill';

type RestaurantRatingProps = {
  restaurant: RatedRestaurant;
  style?: StyleProp<ViewStyle>;
  /**
   * 'card' on a feed row; 'pill' inside the restaurant page's facts row, where
   * it has to match the surrounding fact pills' geometry exactly.
   */
  variant?: RestaurantRatingVariant;
};

export default function RestaurantRating({
  restaurant,
  style,
  variant = 'card',
}: RestaurantRatingProps) {
  const summary = getRestaurantRatingSummary(restaurant);

  return (
    <View
      style={[styles.row, variant === 'pill' ? styles.rowPill : styles.rowCard, style]}
      // Grouped and relabelled: read child by child, a screen reader announces
      // the star glyph as "black star" and "(12)" as a stray parenthetical.
      accessible
      accessibilityLabel={summary.accessibilityLabel}
    >
      {summary.kind === 'rated' ? (
        <>
          <Text style={styles.star} numberOfLines={1}>
            {RATING_STAR}
          </Text>
          <Text style={styles.average} numberOfLines={1}>
            {summary.average}
          </Text>
          {/* The denominator is not decoration and is never dropped: 5.0 from
              one order and 4.6 from two hundred are different claims. */}
          <Text style={styles.count} numberOfLines={1}>
            {summary.countShort}
          </Text>
        </>
      ) : (
        <Text style={styles.unrated} numberOfLines={1}>
          {summary.label}
        </Text>
      )}
    </View>
  );
}

// Every line in this block is 12/16, and both containers below fix their own
// height, so the two states are interchangeable to the pixel.
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT = 16;

const styles = StyleSheet.create({
  average: {
    color: customerTheme.text,
    fontSize: LABEL_FONT_SIZE,
    fontWeight: '800',
    lineHeight: LABEL_LINE_HEIGHT,
    marginLeft: 4,
  },
  count: {
    color: customerTheme.textMuted,
    fontSize: LABEL_FONT_SIZE,
    fontWeight: '600',
    lineHeight: LABEL_LINE_HEIGHT,
    marginLeft: 4,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  rowCard: {
    // Stated, not inferred. The star glyph's font metrics are taller than the
    // digits' on several of the fonts this app falls back to, so leaving the
    // row to size itself would make a rated card a point or two taller than an
    // unrated one -- the exact feed jitter this component exists to avoid.
    height: LABEL_LINE_HEIGHT + 2,
    marginTop: 6,
  },
  rowPill: {
    backgroundColor: customerTheme.surfaceMuted,
    borderRadius: radius.pill,
    // Matches the sibling fact pills' 12/8 padding box and their 10/8 gaps, so
    // the rating sits in the facts row without nudging the pills after it.
    height: 32,
    marginRight: 10,
    marginTop: 8,
    paddingHorizontal: 12,
  },
  star: {
    /**
     * `accentText` (#8a4500), NOT `brandOrange`/`accent` (#f57c00), which the
     * token layer lists as fill-only. The star is a glyph -- text -- so it has
     * to clear 4.5:1 on every surface this component lands on: 6.97:1 on the
     * card surface (#fbfcfc), 6.38:1 in the detail pill (#edf3f1), 6.27:1 on
     * the closed-shelf card (#fdecec) and 5.66:1 on the out-of-zone card
     * (#f8dfdc), which is the worst case.
     */
    color: customerTheme.accentText,
    fontSize: LABEL_FONT_SIZE,
    lineHeight: LABEL_LINE_HEIGHT,
  },
  unrated: {
    // Brand green, the same weight the average carries. "New" is a neutral
    // fact about a kitchen's age, and it must not read as a demotion beside a
    // restaurant that does have a score.
    color: customerTheme.accentStrong,
    fontSize: LABEL_FONT_SIZE,
    fontWeight: '800',
    lineHeight: LABEL_LINE_HEIGHT,
  },
});
