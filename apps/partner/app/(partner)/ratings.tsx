/**
 * What customers actually said about this restaurant.
 *
 * Reached from the Store tab, not the tab bar: it is read occasionally, not
 * during service, and the four tabs are spent (see STORE_SUB_ROUTES in
 * _layout.tsx).
 *
 * WHAT THIS SCREEN CANNOT SHOW, and must never try to: who left a rating.
 * partnerGetRestaurantRatings returns no `customerId` and no `orderId`, and
 * the screen deliberately holds no order data of its own -- lining a review up
 * against the order list by timestamp would reconstruct exactly the link the
 * backend withheld, on a screen where the restaurant can read the customer's
 * delivery address one tap away.
 */
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { Skeleton, SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
import {
  NO_COMMENT_LABEL,
  RATING_SCALE_MAX,
  describeRatingSummary,
  filledStarCount,
  formatRatingDate,
  formatRatingScore,
} from '../../src/domain/restaurantRatings';
import { usePartnerRatings } from '../../src/hooks/usePartnerRatings';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

/**
 * Decorative by declaration. The score is stated in words beside every star
 * row ("4 out of 5"), so a screen reader that also walked five star glyphs
 * would read the same fact twice -- once as prose and once as punctuation.
 */
function StarRow({ filled, large = false }: { filled: number; large?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.starRow}
    >
      {Array.from({ length: RATING_SCALE_MAX }, (_, index) => (
        <Text
          key={index}
          style={[large ? styles.starLarge : styles.star, index < filled ? styles.starFilled : styles.starEmpty]}
        >
          ★
        </Text>
      ))}
    </View>
  );
}

export default function PartnerRatingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { error, hasMore, loaded, loading, loadingMore, loadMore, ratings, retry, summary } =
    usePartnerRatings();

  const handleBack = () => {
    // Deep-linked or reloaded on the web build there is no history to pop, and
    // `router.back()` on an empty stack leaves the partner on a screen with no
    // way out. Same shape as the account screen's back link.
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/profile' as never);
  };

  if (loading) {
    return (
      <SkeletonScreen>
        <Skeleton width="40%" height={22} />
        <Skeleton width="60%" height={13} style={{ marginBottom: 26, marginTop: 10 }} />
        <Skeleton height={120} radius={14} style={{ marginBottom: 20 }} />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }

  const copy = describeRatingSummary(summary);
  // A request that failed before anything loaded has established NOTHING about
  // this restaurant, so the screen must not fall through to "No ratings yet" --
  // that sentence is a claim, and this state cannot make it.
  const failedCold = error !== null && !loaded;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET }]}
      >
        {/* Labelled because the visible text leads with a bare `&lsaquo;`,
            which a screen reader either reads out as punctuation or drops. */}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to Store" style={styles.backLink} onPress={handleBack}>
          <Text style={styles.backLinkText}>&lsaquo; Store</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Ratings</Text>
        <Text style={styles.subtitle}>
          What customers said after their orders. Feedback is anonymous - you see the score and the comment, never who left it.
        </Text>

        {failedCold ? (
          <View style={styles.errorCard}>
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorTitle}>
              Could not load your ratings
            </Text>
            <Text style={styles.errorCopy}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={retry}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Stale rather than fatal: a failed "Load more" keeps whatever is
                already on screen and says so, instead of emptying the list. */}
            {error ? (
              <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
                {error}
              </Text>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Your rating</Text>
              {copy.state === 'rated' ? (
                <>
                  <Text style={styles.aggregateValue}>{copy.headline}</Text>
                  <StarRow filled={filledStarCount(copy.average)} large />
                  <Text style={styles.aggregateDetail}>{copy.detail}</Text>
                </>
              ) : (
                <>
                  {/* No figure and no star row at all. Five empty stars read as
                      a one-star restaurant, and "0.0" reads worse. */}
                  <Text style={styles.aggregateEmptyValue}>{copy.headline}</Text>
                  <Text style={styles.aggregateDetail}>{copy.detail}</Text>
                </>
              )}
            </View>

            {ratings.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {copy.state === 'rated' ? 'Nothing to show here yet' : 'No ratings yet'}
                </Text>
                <Text style={styles.emptyCopy}>
                  {copy.state === 'rated'
                    ? 'Your score is above, but none of the individual ratings behind it could be listed.'
                    : 'Customers can rate a restaurant once their order is delivered. Ratings and comments land here as they come in.'}
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.listHeading}>Recent feedback</Text>
                {ratings.map((rating) => (
                  <View key={rating.id} style={styles.ratingRow}>
                    <View style={styles.ratingRowHeader}>
                      <StarRow filled={filledStarCount(rating.restaurantScore)} />
                      <Text style={styles.ratingScore}>{formatRatingScore(rating.restaurantScore)}</Text>
                      <Text style={styles.ratingDate}>{formatRatingDate(rating.createdAt)}</Text>
                    </View>
                    {rating.comment ? (
                      <Text style={styles.ratingComment}>{rating.comment}</Text>
                    ) : (
                      // A score with no words is still a data point. Said in
                      // muted type rather than left as a blank line, which
                      // would read as a row that failed to render.
                      <Text style={styles.ratingNoComment}>{NO_COMMENT_LABEL}</Text>
                    )}
                  </View>
                ))}

                {hasMore ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.loadMoreButton, loadingMore ? styles.controlDisabled : null]}
                    onPress={loadMore}
                    disabled={loadingMore}
                  >
                    <Text style={styles.loadMoreText}>{loadingMore ? 'Loading...' : 'Load more'}</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 1100,
    paddingBottom: 30,
    paddingHorizontal: 18,
    width: '100%',
  },
  backLink: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginBottom: 6,
    minHeight: MIN_TAP_TARGET,
    paddingRight: 12,
    paddingVertical: 10,
  },
  backLinkText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    color: partnerTheme.text,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
  },
  subtitle: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  errorCard: {
    backgroundColor: partnerTheme.dangerSoft,
    borderRadius: radius.xl,
    marginTop: 14,
    padding: 18,
  },
  errorTitle: {
    color: partnerTheme.dangerText,
    fontSize: 16,
    fontWeight: '800',
  },
  errorCopy: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  retryButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: 10,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 10,
  },
  retryText: {
    color: partnerTheme.dangerText,
    fontSize: 14,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  cardTitle: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  aggregateValue: {
    color: partnerTheme.text,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 8,
  },
  // Words, not a figure, so it is set at reading size rather than at the scale
  // of a number that is not there.
  aggregateEmptyValue: {
    color: partnerTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 8,
  },
  aggregateDetail: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 8,
  },
  star: {
    fontSize: 15,
  },
  starLarge: {
    fontSize: 20,
  },
  /**
   * `accentText` (#8a4500), NOT `brandOrange`. The orange in this palette is a
   * FILL -- it is the wrong ink for a glyph, which is what a star is: five
   * small shapes carrying the only value in the row. The text counterpart
   * clears 4.5:1 on every light surface in the token layer, including the
   * white card these sit on.
   */
  starFilled: {
    color: partnerTheme.accentText,
  },
  // Low contrast on purpose: an empty star marks an ABSENCE, and drawing it as
  // strongly as a filled one makes a 2-star row look like a 5-star row at a
  // glance. Nothing is communicated by these alone -- the score is written out
  // beside them.
  starEmpty: {
    color: partnerTheme.border,
  },
  listHeading: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 22,
  },
  ratingRow: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  ratingRowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  ratingScore: {
    color: partnerTheme.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 8,
  },
  ratingDate: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    marginLeft: 'auto',
    marginTop: 8,
  },
  ratingComment: {
    color: partnerTheme.textSoft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  ratingNoComment: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 10,
  },
  loadMoreButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 12,
  },
  loadMoreText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  controlDisabled: {
    opacity: 0.5,
  },
  emptyCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  emptyTitle: {
    color: partnerTheme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  emptyCopy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
});
