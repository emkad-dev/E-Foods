import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useCart } from '../../src/contexts/CartContext';
import {
  getCurrentCoordinates,
  reverseGeocode,
  watchCoordinates,
  type Coordinates,
  type LocationWatch,
} from '../../src/services/deviceLocation';
import { LOCATION_ERROR_MESSAGES, coordinatesLabel } from '../../src/services/locationResolution';
import { fallbackAddressFromCoords } from '../../src/utils/deliveryLocation';

type Status = {
  tone: 'error' | 'info';
  text: string;
};

const LIVE_GEOCODE_INTERVAL_MS = 15000;

export default function DeliveryLocationScreen() {
  const insets = useSafeAreaInsets();
  const { deliveryLocation, setDeliveryLocation } = useCart();
  const [address, setAddress] = useState(deliveryLocation?.address ?? '');
  const [label, setLabel] = useState(deliveryLocation?.label ?? deliveryLocation?.shortAddress ?? '');
  const [note, setNote] = useState(deliveryLocation?.note ?? '');
  const [latitude, setLatitude] = useState<number | null>(deliveryLocation?.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(deliveryLocation?.longitude ?? null);
  const [coordinateSource, setCoordinateSource] = useState(deliveryLocation ? 'Saved coordinates' : 'Manual address');
  const [liveTracking, setLiveTracking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const locationWatchRef = useRef<LocationWatch | null>(null);
  const lastGeocodeAtRef = useRef(0);
  const addressEditedRef = useRef(Boolean(deliveryLocation?.address));

  const stopLiveTracking = useCallback(() => {
    locationWatchRef.current?.remove();
    locationWatchRef.current = null;
    setLiveTracking(false);
  }, []);

  useEffect(() => {
    return () => {
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
    };
  }, []);

  const handleAddressChange = useCallback((value: string) => {
    addressEditedRef.current = true;
    setAddress(value);
  }, []);

  /**
   * Reverse geocoding is throttled for live updates only — a deliberate tap on
   * "Use current location" always resolves a fresh address.
   */
  const updateAddressFromCoordinates = useCallback(
    async ({ latitude: nextLatitude, longitude: nextLongitude }: Coordinates, force: boolean) => {
      if (!force && Date.now() - lastGeocodeAtRef.current < LIVE_GEOCODE_INTERVAL_MS) {
        return;
      }

      lastGeocodeAtRef.current = Date.now();

      const resolved = await reverseGeocode(nextLatitude, nextLongitude);

      if (!addressEditedRef.current) {
        setAddress(resolved?.address ?? fallbackAddressFromCoords(nextLatitude, nextLongitude));
      }

      if (resolved?.shortAddress) {
        setLabel((current) => (current.trim() ? current : resolved.shortAddress));
      }

      if (!resolved) {
        setStatus({
          tone: 'info',
          text: 'We pinned your exact spot but could not name the street. Add a landmark below so the rider finds you.',
        });
      }
    },
    []
  );

  const applyCoordinates = useCallback((coordinates: Coordinates, source: string) => {
    setLatitude(coordinates.latitude);
    setLongitude(coordinates.longitude);
    setCoordinateSource(source);
  }, []);

  const handleUseCurrentLocation = useCallback(async () => {
    setLocating(true);
    setStatus({ tone: 'info', text: 'Searching for your location...' });
    stopLiveTracking();

    const result = await getCurrentCoordinates();

    if (!result.ok) {
      setStatus({ tone: 'error', text: result.message });
      setLocating(false);
      return;
    }

    applyCoordinates(result.coordinates, 'Current location');
    setStatus(null);
    await updateAddressFromCoordinates(result.coordinates, true);
    setLocating(false);

    const watch = await watchCoordinates(
      (coordinates) => {
        applyCoordinates(coordinates, 'Live location');
        void updateAddressFromCoordinates(coordinates, false);
      },
      (reason) => {
        stopLiveTracking();
        setStatus({ tone: 'error', text: LOCATION_ERROR_MESSAGES[reason] });
      }
    );

    if (watch) {
      locationWatchRef.current = watch;
      setLiveTracking(true);
    }
  }, [applyCoordinates, stopLiveTracking, updateAddressFromCoordinates]);

  const handleSave = () => {
    const trimmedAddress = address.trim();
    const trimmedLabel = label.trim();

    if (!trimmedAddress) {
      setStatus({ tone: 'error', text: 'Enter your delivery address before saving.' });
      return;
    }

    setDeliveryLocation({
      address: trimmedAddress,
      label: trimmedLabel || null,
      latitude,
      longitude,
      note: note.trim() || null,
      shortAddress: trimmedLabel || trimmedAddress,
      coordinateSource,
    });

    stopLiveTracking();
    router.replace('/cart');
  };

  const hasCoordinates = latitude !== null && longitude !== null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { paddingTop: insets.top + 12 }]}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <FontAwesome name="arrow-left" size={18} color="#07140c" />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Delivery address</Text>
          <Text style={styles.subtitle}>{liveTracking ? 'Live location on' : 'Manual entry'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.label}>Address</Text>
          <TextInput
            multiline
            onChangeText={handleAddressChange}
            placeholder="Street, house number, area"
            placeholderTextColor="#8b9690"
            style={[styles.input, styles.addressInput]}
            textAlignVertical="top"
            value={address}
          />

          <Text style={styles.label}>Label</Text>
          <TextInput
            onChangeText={setLabel}
            placeholder="Home, office, hostel"
            placeholderTextColor="#8b9690"
            style={styles.input}
            value={label}
          />

          <Text style={styles.label}>Note</Text>
          <TextInput
            multiline
            onChangeText={setNote}
            placeholder="Gate color, landmark, or delivery note"
            placeholderTextColor="#8b9690"
            style={[styles.input, styles.noteInput]}
            textAlignVertical="top"
            value={note}
          />

          <TouchableOpacity
            activeOpacity={0.85}
            disabled={locating}
            onPress={handleUseCurrentLocation}
            style={[styles.locationButton, locating ? styles.locationButtonBusy : null]}
          >
            {locating ? (
              <ActivityIndicator color="#07140c" />
            ) : (
              <FontAwesome name="location-arrow" size={16} color="#07140c" />
            )}
            <Text style={styles.locationButtonText}>
              {locating ? 'Getting location' : liveTracking ? 'Refresh my location' : 'Use current location'}
            </Text>
          </TouchableOpacity>

          {status ? (
            <View style={[styles.statusBanner, status.tone === 'error' ? styles.statusBannerError : null]}>
              <FontAwesome
                name={status.tone === 'error' ? 'exclamation-circle' : 'info-circle'}
                size={14}
                color={status.tone === 'error' ? '#a3231f' : '#25613a'}
              />
              <Text style={[styles.statusText, status.tone === 'error' ? styles.statusTextError : null]}>
                {status.text}
              </Text>
            </View>
          ) : null}

          <View style={styles.coordinatePill}>
            <FontAwesome name="map-marker" size={14} color="#069b3f" />
            <Text style={styles.coordinateText}>
              {hasCoordinates ? `${coordinateSource} · ${coordinatesLabel(latitude, longitude)}` : coordinateSource}
            </Text>
          </View>
          {liveTracking ? <Text style={styles.liveHint}>Location keeps updating while this screen is open.</Text> : null}

          {liveTracking ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={stopLiveTracking}
              style={[styles.locationButton, styles.stopButton]}
            >
              <FontAwesome name="pause" size={14} color="#07140c" />
              <Text style={styles.locationButtonText}>Stop live updates</Text>
            </TouchableOpacity>
          ) : null}
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
    backgroundColor: '#f0f2f1',
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
    borderRadius: 18,
    height: 42,
    justifyContent: 'center',
    marginRight: 12,
    width: 42,
  },
  title: {
    color: '#07140c',
    fontSize: 22,
    fontWeight: '900',
  },
  subtitle: {
    color: '#66736d',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  content: {
    padding: 20,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4df',
    borderRadius: 28,
    borderWidth: 1,
    padding: 18,
  },
  label: {
    color: '#07140c',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 14,
  },
  input: {
    backgroundColor: '#f6f8f7',
    borderColor: '#dbe4df',
    borderRadius: 18,
    borderWidth: 1,
    color: '#07140c',
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
    backgroundColor: '#cff5dd',
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  locationButtonBusy: {
    opacity: 0.75,
  },
  locationButtonText: {
    color: '#07140c',
    fontSize: 15,
    fontWeight: '900',
    marginLeft: 8,
  },
  statusBanner: {
    alignItems: 'flex-start',
    backgroundColor: '#eefaf2',
    borderRadius: 16,
    flexDirection: 'row',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusBannerError: {
    backgroundColor: '#fdecea',
  },
  statusText: {
    color: '#25613a',
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginLeft: 8,
  },
  statusTextError: {
    color: '#a3231f',
  },
  coordinatePill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#eefaf2',
    borderRadius: 999,
    flexDirection: 'row',
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  coordinateText: {
    color: '#25613a',
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 6,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#06b84f',
    borderRadius: 20,
    marginTop: 18,
    paddingVertical: 17,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  liveHint: {
    color: '#25613a',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
  },
  stopButton: {
    backgroundColor: '#dff4e7',
    marginTop: 12,
  },
});
