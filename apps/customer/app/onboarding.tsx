/**
 * First-run location step.
 *
 * FEASTY lets people browse without an account, but the feed is location-aware:
 * CoverageContext filters restaurants against the delivery location, so until
 * one is set a visitor sees an ungated list and only finds out at checkout
 * whether anyone delivers to them. This asks first.
 *
 * It is skippable on purpose. Skipping lands on the feed exactly as before this
 * screen existed, and is remembered so it never nags again — see
 * domain/customerOnboarding.ts for why the flag records "shown", not
 * "satisfied".
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../src/contexts/CartContext';
import { getCurrentCoordinates, reverseGeocode } from '../src/services/deviceLocation';
import { markLocationStepSeen } from '../src/services/customerOnboardingState';
import { customerTheme } from '../src/theme/palette';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setDeliveryLocation } = useCart();

  const [locating, setLocating] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    await markLocationStepSeen();
    router.replace('/home' as never);
  };

  const handleUseMyLocation = async () => {
    if (locating) {
      return;
    }
    setError(null);
    setLocating(true);
    try {
      const result = await getCurrentCoordinates();
      if (!result.ok) {
        // The service already produces a human message per reason
        // (permission-denied, unavailable, timeout); typing an address is
        // always the fallback, so this is a nudge, not a dead end.
        setError(result.message);
        return;
      }

      const { latitude, longitude } = result.coordinates;
      // A failed reverse geocode must not lose the fix: the coordinates are
      // what coverage actually needs, the text is only for display.
      const resolved = await reverseGeocode(latitude, longitude).catch(() => null);

      setDeliveryLocation({
        address: resolved?.address ?? 'Current location',
        latitude,
        longitude,
        shortAddress: resolved?.shortAddress ?? null,
      });
      await finish();
    } catch {
      setError('We could not read your location. Type your address instead.');
    } finally {
      setLocating(false);
    }
  };

  const handleUseTypedAddress = async () => {
    const address = manualAddress.trim();
    if (!address) {
      setError('Enter an address, or skip for now.');
      return;
    }

    // No coordinates: a typed address cannot be coverage-checked until it is
    // geocoded at checkout, which is where the existing flow already resolves
    // it. Storing it here still saves the customer retyping.
    setDeliveryLocation({ address, latitude: null, longitude: null, shortAddress: null });
    await finish();
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 48 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>FEASTY</Text>
      <Text style={styles.title}>Where are we delivering?</Text>
      <Text style={styles.copy}>
        We use this to show only the restaurants that actually deliver to you — and how long they will take.
      </Text>

      <TouchableOpacity
        disabled={locating}
        onPress={() => void handleUseMyLocation()}
        style={[styles.primaryButton, locating ? styles.buttonDisabled : null]}
      >
        {locating ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Use my current location</Text>
        )}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <TextInput
        style={styles.input}
        onChangeText={(value) => {
          setError(null);
          setManualAddress(value);
        }}
        placeholder="Enter your delivery address"
        placeholderTextColor={customerTheme.textSoft}
        value={manualAddress}
      />

      <TouchableOpacity onPress={() => void handleUseTypedAddress()} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Use this address</Text>
      </TouchableOpacity>

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
    color: customerTheme.text,
    fontSize: 30,
    fontWeight: '900',
    marginTop: 10,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 28,
    marginTop: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderRadius: 16,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
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
  input: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 15,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceMuted,
    borderRadius: 16,
    marginTop: 12,
    paddingVertical: 15,
  },
  secondaryButtonText: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '900',
  },
  errorText: {
    color: customerTheme.danger,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  skipButton: {
    alignItems: 'center',
    marginTop: 28,
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
