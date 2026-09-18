/**
 * Which order ratings this customer has already dealt with, remembered across
 * launches.
 *
 * WHY IT EXISTS. `selectNextPendingRating`'s `handledOrderIds` is session-only
 * by design -- it covers the gap between "submit succeeded" and "the next fetch
 * confirms the order left the pending list", and its own doc says so. Nothing
 * persisted it, so "Not now" lasted exactly as long as the component did.
 *
 * The prompt is a full-screen backdrop over the whole app, it refetches on
 * every mount and every return to the foreground, and the pending list is
 * simply every delivered order without an OrderRating row. So declining to rate
 * meant being asked again on the next launch, and the next, forever. Measured
 * against production: one customer, three delivered orders from the same
 * restaurant, two rated. The third re-prompted indefinitely, and because all
 * three carried the same restaurant name the card looked identical each time --
 * which is why it reads as a loop rather than as a queue.
 *
 * `customerOnboarding.ts` already makes this exact argument for the location
 * gate: it records that the step was SHOWN, not that it was satisfied, because
 * "otherwise skipping would re-prompt on every launch, which is a nag, not
 * onboarding". Same rule, same reason.
 *
 * Pure and IO-free -- the AsyncStorage read/write lives in
 * services/ratingPromptDismissals.ts so this stays unit-testable, matching the
 * split this codebase uses everywhere else.
 */

export const DISMISSED_RATINGS_KEY = 'feasty.ratingPrompt.dismissed';

/**
 * How many dismissals to remember.
 *
 * Unbounded, this list grows once per declined order for the life of the
 * install. Bounded, the oldest entry eventually falls off and that order could
 * prompt once more -- which is the right way round: re-asking about a delivery
 * from fifty orders ago is a far smaller harm than a list that grows forever in
 * storage the customer cannot clear.
 */
export const MAX_REMEMBERED_DISMISSALS = 50;

/**
 * Tolerant on purpose. This value is read at startup to decide whether to cover
 * the screen with a modal; corrupt or hand-edited storage must degrade to "show
 * the prompt", never to a crash on launch. Anything that is not an array of
 * non-empty strings is discarded.
 */
export const parseDismissedOrderIds = (raw: string | null | undefined): string[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set<string>();

    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim())
      .filter((entry) => {
        if (seen.has(entry)) {
          return false;
        }
        seen.add(entry);
        return true;
      })
      .slice(-MAX_REMEMBERED_DISMISSALS);
  } catch {
    return [];
  }
};

/**
 * Append one id, newest last, de-duplicated and capped.
 *
 * Re-dismissing an id already present MOVES it to the end rather than leaving
 * it where it was: it was just acted on, so it is the least sensible entry to
 * evict next.
 */
export const mergeDismissedOrderIds = (
  existing: readonly string[],
  orderId: string
): string[] => {
  const trimmed = orderId.trim();

  if (!trimmed) {
    return [...existing];
  }

  return [...existing.filter((entry) => entry !== trimmed), trimmed].slice(
    -MAX_REMEMBERED_DISMISSALS
  );
};

export const serializeDismissedOrderIds = (orderIds: readonly string[]): string =>
  JSON.stringify(orderIds.slice(-MAX_REMEMBERED_DISMISSALS));
