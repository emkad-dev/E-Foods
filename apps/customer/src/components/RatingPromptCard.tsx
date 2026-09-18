// Post-delivery rating prompt (Task 12/E1). Mounted once, globally, in
// (customer)/_layout.tsx alongside <PromoBanner /> — same "global overlay
// card driven by a fetch, dismissible" shape PromoBanner already uses, rather
// than inventing a new modal surface (this app has no react-native <Modal>
// usage anywhere).
//
// Fetch triggers deliberately follow Task 5's realtime/no-polling convention:
// once on mount, and again whenever the app returns to the foreground
// (useAppStateVisibility) — no setInterval. A pending-ratings check on
// mount/focus is exactly what the brief calls for; a dedicated realtime
// subscription for this alone was judged unnecessary complexity for a prompt
// that is not time-critical.
import { FontAwesome } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { useAuth } from '../contexts/AuthContext';
import { isValidScore, selectNextPendingRating, type PendingRating } from '../domain/ratingPrompt';
import { getPendingOrderRatings, submitOrderRating } from '../services/customerRatings';
import {
  readDismissedRatingOrderIds,
  rememberDismissedRatingOrderId,
} from '../services/ratingPromptDismissals';
import { customerTheme } from '../theme/palette';

const StarRow = ({
  value,
  onChange,
  size = 30,
}: {
  onChange: (next: number) => void;
  size?: number;
  value: number | null;
}) => (
  <View style={styles.starRow}>
    {[1, 2, 3, 4, 5].map((star) => (
      <TouchableOpacity
        key={star}
        style={styles.starButton}
        onPress={() => onChange(star)}
        // Kept for native, where it widens the target past the floor. It is
        // NOT what makes this control legal: on the web build RNW 0.21 reads
        // hitSlop only from the legacy Touchable mixin, so it does nothing at
        // all -- which is exactly what it was silently doing here before.
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Rate ${star} star${star === 1 ? '' : 's'}`}
      >
        <FontAwesome
          name={value !== null && star <= value ? 'star' : 'star-o'}
          size={size}
          color={value !== null && star <= value ? customerTheme.accentStrong : customerTheme.textMuted}
          style={styles.star}
        />
      </TouchableOpacity>
    ))}
  </View>
);

export default function RatingPromptCard() {
  const { user } = useAuth();
  const isVisible = useAppStateVisibility();
  const [pending, setPending] = useState<PendingRating[]>([]);
  // Orders this prompt is done with: submitted, already_rated, or declined.
  //
  // Seeded from storage on mount, so "Not now" survives a relaunch. It used to
  // be session-only, which meant a customer who declined to rate was covered by
  // this full-screen card again on the very next launch, and the one after, for
  // as long as the order stayed unrated -- which is forever, because declining
  // is not rating. See domain/ratingPromptDismissals.ts.
  const [handledOrderIds, setHandledOrderIds] = useState<Set<string>>(new Set());
  // Held back until the dismissals have loaded. Rendering the card first and
  // hiding it a tick later would flash the prompt for orders the customer
  // already said no to -- the exact thing this is meant to stop.
  const [dismissalsLoaded, setDismissalsLoaded] = useState(false);
  // A failed submit used to be swallowed entirely, on the reasoning that the
  // prompt staying up let the customer retry. But nothing said it had failed,
  // so the card just sat there looking untouched: tap Submit, nothing happens,
  // tap again. Silence on a control the customer pressed is the other half of
  // what makes this feel like a loop.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [restaurantScore, setRestaurantScore] = useState<number | null>(null);
  const [courierScore, setCourierScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const activeRef = useRef(false);
  const wasVisibleRef = useRef(isVisible);

  const refresh = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      const orders = await getPendingOrderRatings();
      if (activeRef.current) {
        setPending(orders);
      }
    } catch {
      // Best-effort: a failed fetch just means the prompt doesn't show this
      // pass — no error banner for a background check the customer never
      // asked for.
    }
  }, [user]);

  useEffect(() => {
    activeRef.current = Boolean(user);

    if (!user) {
      setPending([]);
      setHandledOrderIds(new Set());
      // Reset so the next sign-in re-reads rather than trusting the last
      // account's list.
      setDismissalsLoaded(false);
      return;
    }

    void (async () => {
      const dismissed = await readDismissedRatingOrderIds();
      if (activeRef.current) {
        setHandledOrderIds((previous) => new Set([...previous, ...dismissed]));
        setDismissalsLoaded(true);
      }
    })();

    void refresh();

    return () => {
      activeRef.current = false;
    };
  }, [user, refresh]);

  useEffect(() => {
    // Refetch only on the false -> true transition (returning to the
    // foreground), never on every render while already visible.
    if (isVisible && !wasVisibleRef.current && user) {
      void refresh();
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, user, refresh]);

  const current = selectNextPendingRating(pending, handledOrderIds);

  // Reset the form whenever a new order becomes current. The error goes with
  // it: a failure belongs to the order it was raised for, and carrying it onto
  // the next card would blame a submit that never happened.
  useEffect(() => {
    setRestaurantScore(null);
    setCourierScore(null);
    setComment('');
    setSubmitError(null);
  }, [current?.orderId]);

  const markHandled = useCallback((orderId: string) => {
    setHandledOrderIds((previous) => new Set(previous).add(orderId));
    // Fire-and-forget: the in-memory set above is what hides the card now, and
    // a storage failure must not block that or raise anything at the customer.
    void rememberDismissedRatingOrderId(orderId);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!current || !isValidScore(restaurantScore) || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitOrderRating({
        comment: comment.trim() || null,
        courierScore: current.hasCourier && isValidScore(courierScore) ? courierScore : null,
        orderId: current.orderId,
        restaurantScore,
      });
      // Both the 'submitted' and 'already_rated' outcomes mean "this order is
      // resolved, stop prompting for it" — submitOrderRating never throws for
      // already_rated (the UNIQUE constraint is the real guard; see its own
      // doc comment), so reaching here at all already covers both cases.
      markHandled(current.orderId);
    } catch (error) {
      // Still leave the prompt up so the rating they typed is not discarded --
      // but SAY so. `clientErrorMessage`-style sanitising already happens
      // server-side; whatever arrives here is safe to show, and a generic line
      // covers the case where it is not readable.
      if (activeRef.current) {
        setSubmitError(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'That did not go through. Check your connection and try again.'
        );
      }
    } finally {
      if (activeRef.current) {
        setSubmitting(false);
      }
    }
  }, [current, restaurantScore, courierScore, comment, submitting, markHandled]);

  const handleSkip = useCallback(() => {
    if (current) {
      markHandled(current.orderId);
    }
  }, [current, markHandled]);

  // `dismissalsLoaded` gates the first paint only; once loaded it stays true
  // for the session, so this never re-hides a prompt mid-use.
  if (!user || !dismissalsLoaded || !current) {
    return null;
  }

  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={handleSkip} accessibilityLabel="Dismiss rating prompt" />
      <View style={styles.card}>
        <Text style={styles.title}>How was your order?</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {current.restaurantName}
        </Text>

        <StarRow value={restaurantScore} onChange={setRestaurantScore} />

        {current.hasCourier ? (
          <>
            <Text style={styles.sectionLabel}>Rate your delivery rider (optional)</Text>
            <StarRow value={courierScore} onChange={setCourierScore} size={24} />
          </>
        ) : null}

        <TextInput
          style={styles.commentInput}
          placeholder="Add a comment (optional)"
          placeholderTextColor={customerTheme.textMuted}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={500}
        />

        {submitError ? (
          <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
            {submitError}
          </Text>
        ) : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity onPress={handleSkip} style={styles.skipButton} disabled={submitting}>
            <Text style={styles.skipText}>Not now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!isValidScore(restaurantScore) || submitting}
            style={[
              styles.submitButton,
              (!isValidScore(restaurantScore) || submitting) && styles.submitButtonDisabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={customerTheme.textOnBrand} size="small" />
            ) : (
              <Text style={styles.submitText}>Submit rating</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 21, 34, 0.55)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 20,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 200,
  },
  card: {
    backgroundColor: customerTheme.surface,
    borderRadius: radius.xl,
    maxWidth: 420,
    padding: 20,
    width: '100%',
  },
  title: {
    color: customerTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: customerTheme.textMuted,
    fontSize: 13,
    marginBottom: 14,
    marginTop: 2,
  },
  sectionLabel: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 14,
  },
  starRow: {
    flexDirection: 'row',
    gap: 6,
  },
  // The stars had no style at all, so each target was exactly its glyph: 30pt
  // on the restaurant row and 24pt on the rider row. Five of them in a line,
  // where a mis-tap does not miss -- it silently submits a different rating
  // than the one intended, which is worse than nothing happening.
  //
  // The glyph keeps its drawn size and the BOX grows to the floor; five 44pt
  // boxes and their gaps still sit well inside a 375pt screen.
  starButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
  },
  star: {
    marginRight: 4,
  },
  commentInput: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 13,
    marginTop: 16,
    minHeight: 64,
    padding: 12,
    textAlignVertical: 'top',
  },
  errorText: {
    color: customerTheme.dangerText,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  skipButton: {
    alignItems: 'center',
    borderColor: customerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  skipText: {
    color: customerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accentStrong,
    borderRadius: radius.lg,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: customerTheme.textOnBrand,
    fontSize: 14,
    fontWeight: '800',
  },
});
