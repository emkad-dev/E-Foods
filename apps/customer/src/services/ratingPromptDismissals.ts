// AsyncStorage wiring for the rating prompt's remembered dismissals. All the
// decisions (parsing, de-duplication, the cap) live in the pure
// ../domain/ratingPromptDismissals.ts module, which is what the tests exercise;
// this file is the thin IO layer, matching customerOnboardingState.ts over
// customerOnboarding.ts.
//
// AsyncStorage rather than the raw `window.localStorage` PromoBanner uses: this
// prompt ships to phones as well as app.feasty.com.ng, and PromoBanner's own
// comment records that its native persistence is an unfinished follow-up. There
// is no reason to inherit that gap here.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DISMISSED_RATINGS_KEY,
  mergeDismissedOrderIds,
  parseDismissedOrderIds,
  serializeDismissedOrderIds,
} from '../domain/ratingPromptDismissals';

/**
 * Never throws. A storage failure must mean "we do not know what was
 * dismissed", which degrades to showing the prompt -- the same outcome as
 * before anything was remembered at all. It must never stop the app booting.
 */
export const readDismissedRatingOrderIds = async (): Promise<string[]> => {
  try {
    return parseDismissedOrderIds(await AsyncStorage.getItem(DISMISSED_RATINGS_KEY));
  } catch {
    return [];
  }
};

/**
 * Read-modify-write rather than holding the list in memory and overwriting it:
 * the prompt is mounted once globally, but a second tab on the web build shares
 * this storage, and clobbering the whole list from stale in-memory state would
 * resurrect prompts the customer dismissed in the other tab.
 *
 * Returns the persisted list so the caller can keep its own state in step
 * without a second read.
 */
export const rememberDismissedRatingOrderId = async (orderId: string): Promise<string[]> => {
  try {
    const next = mergeDismissedOrderIds(await readDismissedRatingOrderIds(), orderId);
    await AsyncStorage.setItem(DISMISSED_RATINGS_KEY, serializeDismissedOrderIds(next));
    return next;
  } catch {
    // Quota, privacy mode, or a native storage failure. The dismissal still
    // holds for this session through the caller's own in-memory set; it just
    // will not survive a relaunch.
    return [];
  }
};
