/**
 * First-run location step.
 *
 * FEASTY lets people browse without an account, but the feed is location-aware:
 * CoverageContext filters restaurants against the delivery location, so until
 * one is set a visitor sees an ungated list and only finds out at checkout
 * whether anyone delivers to them. This asks first.
 *
 * It is skippable on purpose. Skipping lands on the feed exactly as before this
 * screen existed. Saving needs a pin (a GPS fix or a picked search result):
 * typed text alone cannot be coverage-checked, so it is no longer offered. The persisted flag stops the first-run REDIRECT from repeating;
 * Home also asks once per app launch while no address is saved (in memory, see
 * utils/launchAddressPrompt.ts), reusing this screen. See
 * domain/customerOnboarding.ts for why the flag records "shown", not "satisfied".
 */
import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, type AddressPickOrigin, type AddressSuggestion } from '@feasty/design-system';
import CustomerAddressSearch from '../src/components/CustomerAddressSearch';
import { screenColumn } from '../src/components/ScreenColumn';
import { useCart } from '../src/contexts/CartContext';
import { addressEntryReducer, initAddressEntry, toSavedAddress, type AddressPin } from '../src/domain/addressEntry';
import { createLatestChoice } from '../src/domain/latestChoice';
import { useCurrentLocationPin } from '../src/hooks/useCurrentLocationPin';
import { markLocationStepSeen } from '../src/services/customerOnboardingState';
import { markLaunchAddressPromptShown } from '../src/utils/launchAddressPrompt';
import { hasTextOnlyAddress } from '../src/utils/savedAddress';
import { customerTheme } from '../src/theme/palette';
import { pageTitleTextStyle } from '../src/theme/screenChrome';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deliveryLocation, setDeliveryLocation } = useCart();
  // An older build saved typed text with no pin; it no longer counts, so say why we ask again.
  const earlierTypedAddress = hasTextOnlyAddress(deliveryLocation) ? deliveryLocation?.address.trim() : null;

  const { locate, locating } = useCurrentLocationPin();
  const [error, setError] = useState<string | null>(null);
  const finishingRef = useRef(false);
  // The customer's last choice wins: a slow fix must not replace a place picked
  // while it was running. See domain/latestChoice.ts.
  const choiceRef = useRef(createLatestChoice());

  const finish = async () => {
    // A double tap must leave once, not back out twice.
    if (finishingRef.current) {
      return;
    }
    finishingRef.current = true;
    // Whichever way the visitor leaves (saved or skipped), this launch has
    // asked, so Home must not ask again on top of the first-run step.
    markLaunchAddressPromptShown();
    await markLocationStepSeen();
    // Home pushes this screen on later launches; first run reaches it by redirect.
    // Go back when there is a Home underneath, otherwise replace, so the stack never
    // ends up with two Homes.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home' as never);
    }
  };

  // The same pin rules as the delivery-address screen (domain/addressEntry.ts):
  // the address text follows the pin, and nothing is saved without one.
  const saveAndFinish = async (pin: AddressPin) => {
    // Already leaving (saved, or skipped while a fix was running): save nothing more.
    if (finishingRef.current) {
      return;
    }
    const saved = toSavedAddress(addressEntryReducer(initAddressEntry(null), { type: 'pinned', pin }));
    if (!saved) {
      setError('That place could not be pinned. Try another search result, or use your current location.');
      return;
    }
    setDeliveryLocation(saved);
    await finish();
  };

  const handleUseMyLocation = async () => {
    if (finishingRef.current || locating) {
      return;
    }
    const ticket = choiceRef.current.next();
    setError(null);
    const result = await locate();
    if (!result || finishingRef.current || !choiceRef.current.isLatest(ticket)) {
      return;
    }
    if (!result.ok) {
      // A human message per reason (blocked, too coarse, timed out); search is
      // always the next step, so this is a nudge, not a dead end.
      setError(result.message);
      return;
    }
    await saveAndFinish({
      latitude: result.pin.latitude,
      longitude: result.pin.longitude,
      label: result.pin.label,
      shortLabel: result.pin.shortAddress,
      source: 'gps',
    });
  };

  const handlePick = (suggestion: AddressSuggestion, origin: AddressPickOrigin) => {
    if (finishingRef.current) {
      return;
    }
    choiceRef.current.next();
    setError(null);
    void saveAndFinish({
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      label: suggestion.label,
      source: origin === 'map-search' ? 'map-search' : 'suggestion',
    });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        screenColumn.reading,
        { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 48 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>FEASTY</Text>
      <Text style={styles.title}>Where are we delivering?</Text>
      <Text style={styles.copy}>
        We use this to show only the restaurants that actually deliver to you — and how long they will take.
      </Text>
      {earlierTypedAddress ? (
        <Text style={styles.earlierAddress}>
          Confirm your address on the map. You typed “{earlierTypedAddress}” before; search for it below or use your
          current location so we can pin it.
        </Text>
      ) : null}

      <TouchableOpacity
        disabled={locating}
        onPress={() => void handleUseMyLocation()}
        style={[styles.primaryButton, locating ? styles.buttonDisabled : null]}
      >
        {locating ? (
          <ActivityIndicator color={customerTheme.textOnBrand} />
        ) : (
          <Text style={styles.primaryButtonText}>Use my current location</Text>
        )}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <CustomerAddressSearch label="Search for your address" onSelect={handlePick} />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity onPress={() => void finish()} style={styles.skipButton}>
        <Text style={styles.skipText}>Skip for now</Text>
      </TouchableOpacity>
      <Text style={styles.skipHint}>You can set this any time from the home screen.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: 22,
  },
  eyebrow: {
    color: customerTheme.brandGreen,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    ...pageTitleTextStyle,
    marginTop: 10,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 28,
    marginTop: 10,
  },
  earlierAddress: {
    backgroundColor: customerTheme.accentTint,
    borderRadius: radius.lg,
    color: customerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginBottom: 18,
    marginTop: -12,
    padding: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderRadius: radius.lg,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: customerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginVertical: 22,
  },
  dividerLine: {
    backgroundColor: customerTheme.border,
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: customerTheme.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  errorText: {
    color: customerTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  skipButton: {
    alignItems: 'center',
    // 39pt as measured on the running build, on the one control that lets a
    // visitor past the first screen without handing over a location.
    justifyContent: 'center',
    marginTop: 28,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 10,
  },
  skipText: {
    color: customerTheme.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  skipHint: {
    color: customerTheme.textSoft,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
});
