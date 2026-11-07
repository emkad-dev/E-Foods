import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, type AddressPickOrigin, type AddressSuggestion } from '@feasty/design-system';
import CustomerAddressSearch from '../../src/components/CustomerAddressSearch';
import ScreenColumn, { screenColumn } from '../../src/components/ScreenColumn';
import { useCart } from '../../src/contexts/CartContext';
import { useCoverage } from '../../src/contexts/CoverageContext';
import {
  PIN_SOURCE_LABEL,
  addressEntryReducer,
  initAddressEntry,
  pinBesideText,
  toSavedAddress,
} from '../../src/domain/addressEntry';
import { useCurrentLocationPin } from '../../src/hooks/useCurrentLocationPin';
import { coordinatesLabel } from '../../src/services/locationResolution';
import { customerTheme } from '../../src/theme/palette';
import { screenTitleTextStyle } from '../../src/theme/screenChrome';
import { hasTextOnlyAddress } from '../../src/utils/savedAddress';
import {
  COVERAGE_COMING_SOON_COPY,
  COVERAGE_COMING_SOON_TITLE,
  describeNearestKitchen,
} from '../../src/utils/coverageMessaging';

type Status = {
  tone: 'error' | 'info';
  text: string;
};

const NO_PIN_MESSAGE =
  'Pick your address from the search results, or use your current location, so the rider knows exactly where to come.';

const TEXT_ONLY_MESSAGE = 'Confirm your address on the map: search for it below or use your current location.';

export default function DeliveryLocationScreen() {
  const insets = useSafeAreaInsets();
  const { deliveryLocation, fulfillmentType, setDeliveryLocation } = useCart();
  // Same screen for both: only the wording changes for someone collecting.
  const isCollection = fulfillmentType === 'pickup';
  const { checkCoverage, isCovered, nearestOrderableKm } = useCoverage();
  // The pin is the address; the text is free. See domain/addressEntry.ts.
  const [entry, dispatch] = useReducer(addressEntryReducer, deliveryLocation, initAddressEntry);
  const [label, setLabel] = useState(deliveryLocation?.label ?? '');
  const [note, setNote] = useState(deliveryLocation?.note ?? '');
  // An address an older build saved as text only: keep the words, ask for the pin.
  const [status, setStatus] = useState<Status | null>(() =>
    hasTextOnlyAddress(deliveryLocation) ? { tone: 'info', text: TEXT_ONLY_MESSAGE } : null
  );
  const { locate, locating } = useCurrentLocationPin();

  const handleUseCurrentLocation = useCallback(async () => {
    setStatus({ tone: 'info', text: 'Finding your location...' });
    const result = await locate();
    if (!result) {
      return;
    }

    if (!result.ok) {
      setStatus({ tone: 'error', text: result.message });
      return;
    }

    dispatch({
      type: 'pinned',
      pin: {
        latitude: result.pin.latitude,
        longitude: result.pin.longitude,
        label: result.pin.label,
        shortLabel: result.pin.shortAddress,
        source: 'gps',
      },
    });
    setStatus(
      result.pin.label
        ? null
        : {
            tone: 'info',
            text: 'We pinned your exact spot but could not name the street. Add a landmark below so the rider finds you.',
          }
    );
  }, [locate]);

  const handlePick = useCallback((suggestion: AddressSuggestion, origin: AddressPickOrigin) => {
    dispatch({
      type: 'pinned',
      pin: {
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        label: suggestion.label,
        source: origin === 'map-search' ? 'map-search' : 'suggestion',
      },
    });
    setStatus(null);
  }, []);

  const handleSave = () => {
    const nextLocation = toSavedAddress(entry, { label, note });

    // Text alone is not an address: it cannot be checked for coverage or found by a rider.
    if (!nextLocation) {
      setStatus({ tone: 'error', text: NO_PIN_MESSAGE });
      return;
    }

    setDeliveryLocation(nextLocation);

    // Synchronous verdict for the address just saved — isCovered is a render behind.
    if (!checkCoverage(nextLocation).isCovered) {
      return;
    }

    router.replace('/cart');
  };

  const { pin } = entry;
  const besideText = pinBesideText(entry);
  const nearestKitchenDescription = describeNearestKitchen(nearestOrderableKm);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { paddingTop: insets.top + 12 }]}
    >
      <View style={[styles.header, screenColumn.reading]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <FontAwesome name="arrow-left" size={18} color={customerTheme.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>{isCollection ? 'Your address' : 'Delivery address'}</Text>
          <Text style={styles.subtitle}>{pin ? 'Pin set' : 'No pin yet'}</Text>
        </View>
      </View>

      {!isCovered ? (
        <ScreenColumn>
          <View style={styles.comingSoonPanel}>
            <Text style={styles.comingSoonTitle}>{COVERAGE_COMING_SOON_TITLE}</Text>
            <Text style={styles.comingSoonCopy}>{COVERAGE_COMING_SOON_COPY}</Text>
            {nearestKitchenDescription ? (
              <Text style={styles.comingSoonMeta}>{nearestKitchenDescription}</Text>
            ) : null}
          </View>
        </ScreenColumn>
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.content, screenColumn.reading, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={locating}
            onPress={() => void handleUseCurrentLocation()}
            style={[styles.locationButton, locating ? styles.locationButtonBusy : null]}
          >
            {locating ? (
              <ActivityIndicator color={customerTheme.text} />
            ) : (
              <FontAwesome name="location-arrow" size={16} color={customerTheme.text} />
            )}
            <Text style={styles.locationButtonText}>{locating ? 'Getting location' : 'Use my current location'}</Text>
          </TouchableOpacity>

          {status ? (
            <View style={[styles.statusBanner, status.tone === 'error' ? styles.statusBannerError : null]}>
              <FontAwesome
                name={status.tone === 'error' ? 'exclamation-circle' : 'info-circle'}
                size={14}
                color={status.tone === 'error' ? customerTheme.dangerText : customerTheme.accentStrong}
              />
              <Text style={[styles.statusText, status.tone === 'error' ? styles.statusTextError : null]}>
                {status.text}
              </Text>
            </View>
          ) : null}

          <View style={styles.searchBlock}>
            <CustomerAddressSearch label="Or search for your address" onSelect={handlePick} />
          </View>

          <View style={styles.coordinatePill}>
            <FontAwesome name="map-marker" size={14} color={customerTheme.brandGreen} />
            <Text style={styles.coordinateText}>
              {pin
                ? `${PIN_SOURCE_LABEL[pin.source]} · ${pin.label ?? coordinatesLabel(pin.latitude, pin.longitude)}`
                : 'No pin yet'}
            </Text>
          </View>

          <Text style={styles.label}>Address for the rider</Text>
          <TextInput
            multiline
            onChangeText={(value) => dispatch({ type: 'typed', text: value })}
            placeholder="House number, street, area"
            placeholderTextColor={customerTheme.textDisabled}
            style={[styles.input, styles.addressInput]}
            textAlignVertical="top"
            value={entry.text}
          />
          {/* Typed text is kept when the pin moves; the pinned place is shown
              beside it so the two can never silently disagree. */}
          {besideText ? (
            <View style={styles.pinBeside}>
              <Text style={styles.pinBesideText}>{besideText}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => dispatch({ type: 'use-pin-text' })}
                style={styles.pinBesideButton}
              >
                <Text style={styles.pinBesideButtonText}>Use this as the address</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={styles.label}>Label</Text>
          <TextInput
            onChangeText={setLabel}
            placeholder="Home, office, hostel"
            placeholderTextColor={customerTheme.textDisabled}
            style={styles.input}
            value={label}
          />

          <Text style={styles.label}>Note</Text>
          <TextInput
            multiline
            onChangeText={setNote}
            placeholder="Gate color, landmark, or delivery note"
            placeholderTextColor={customerTheme.textDisabled}
            style={[styles.input, styles.noteInput]}
            textAlignVertical="top"
            value={note}
          />
        </View>

        <TouchableOpacity activeOpacity={0.9} onPress={handleSave} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>Save address</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 20,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    // radius.pill, not radius.xl: xl (20) only read as a circle because it
    // happened to equal half of the old 42pt box, so growing the box to the
    // 44pt tap-target minimum would have quietly turned it into a squircle.
    borderRadius: radius.pill,
    height: MIN_TAP_TARGET,
    justifyContent: 'center',
    marginRight: 12,
    width: MIN_TAP_TARGET,
  },
  // This row is a native header drawn by hand -- back button, then title --
  // so it takes the title-bar scale instead of a size of its own. At 22/900 it
  // was louder than the real header the user had just come from.
  title: screenTitleTextStyle,
  subtitle: {
    color: customerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  content: {
    padding: 20,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: customerTheme.borderSubtle,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    padding: 18,
  },
  label: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 14,
  },
  input: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.borderSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addressInput: {
    minHeight: 96,
  },
  noteInput: {
    minHeight: 82,
  },
  locationButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accentSoft,
    borderRadius: radius.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  locationButtonBusy: {
    opacity: 0.75,
  },
  locationButtonText: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '900',
    marginLeft: 8,
  },
  statusBanner: {
    alignItems: 'flex-start',
    backgroundColor: customerTheme.accentTint,
    borderRadius: radius.lg,
    flexDirection: 'row',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusBannerError: {
    backgroundColor: customerTheme.dangerSoft,
  },
  statusText: {
    color: customerTheme.accentStrong,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginLeft: 8,
  },
  statusTextError: {
    color: customerTheme.dangerText,
  },
  searchBlock: {
    marginTop: 18,
  },
  coordinatePill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: customerTheme.accentTint,
    borderRadius: radius.pill,
    flexDirection: 'row',
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  coordinateText: {
    color: customerTheme.accentStrong,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 6,
  },
  pinBeside: {
    backgroundColor: customerTheme.accentTint,
    borderRadius: radius.lg,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  pinBesideText: {
    color: customerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  pinBesideButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
  },
  pinBesideButtonText: {
    color: customerTheme.brandGreen,
    fontSize: 13,
    fontWeight: '900',
    textDecorationLine: 'underline',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderRadius: radius.xl,
    marginTop: 18,
    paddingVertical: 18,
  },
  saveButtonText: {
    color: customerTheme.textOnBrand,
    fontSize: 16,
    fontWeight: '900',
  },
  comingSoonPanel: {
    backgroundColor: customerTheme.warningSoft,
    borderColor: customerTheme.warning,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
  },
  comingSoonTitle: {
    color: customerTheme.warningText,
    fontSize: 15,
    fontWeight: '800',
  },
  comingSoonCopy: {
    color: customerTheme.warningText,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  comingSoonMeta: {
    color: customerTheme.warningText,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
});
