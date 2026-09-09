import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistence for the first-run location step (see domain/customerOnboarding.ts
 * for why the flag records "shown", not "satisfied").
 *
 * Every call swallows its error: onboarding is a convenience, and a storage
 * failure must degrade to "show the feed" rather than block a visitor from
 * browsing. The worst case of a failed read is one extra prompt.
 */
const LOCATION_STEP_SEEN_KEY = '@feasty/customer-location-step-seen';

export const hasSeenLocationStep = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(LOCATION_STEP_SEEN_KEY)) === 'true';
  } catch {
    // Treat an unreadable flag as "already seen": a visitor who cannot be
    // remembered should not be re-prompted forever.
    return true;
  }
};

export const markLocationStepSeen = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(LOCATION_STEP_SEEN_KEY, 'true');
  } catch {
    // Nothing to do — the next launch prompts once more, which is survivable.
  }
};
