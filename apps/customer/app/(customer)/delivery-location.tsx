import { FontAwesome } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../../src/contexts/CartContext';
import {
  fallbackAddressFromCoords,
  formatDeliveryLocation,
} from '../../src/utils/deliveryLocation';

const DEFAULT_DELTA = {
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const FALLBACK_REGION: Region = {
  latitude: 6.5244,
  longitude: 3.3792,
  ...DEFAULT_DELTA,
};

type LocationSuggestion = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle: string;
  displayName: string;
};

export default function DeliveryLocationScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);
  const { deliveryLocation, setDeliveryLocation } = useCart();
  const [region, setRegion] = useState<Region | null>(
    deliveryLocation
      ? {
          latitude: deliveryLocation.latitude,
          longitude: deliveryLocation.longitude,
          ...DEFAULT_DELTA,
        }
      : null
  );
  const [resolvedAddress, setResolvedAddress] = useState(
    deliveryLocation?.address ?? 'Finding your delivery address...'
  );
  const [shortAddress, setShortAddress] = useState(
    deliveryLocation?.shortAddress ?? 'Move the map to place the pin'
  );
  const [loadingMap, setLoadingMap] = useState(true);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<LocationSuggestion[]>([]);

  const mapProvider = useMemo(
    () => (Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined),
    []
  );

  useEffect(() => {
    let cancelled = false;

    const loadInitialRegion = async () => {
      if (deliveryLocation) {
        setLoadingMap(false);
        return;
      }

      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (!permission.granted) {
          if (!cancelled) {
            setLocationPermissionDenied(true);
            setRegion(FALLBACK_REGION);
            setLoadingMap(false);
          }
          return;
        }

        const currentPosition =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }));

        if (!cancelled) {
          if (currentPosition) {
            setRegion({
              latitude: currentPosition.coords.latitude,
              longitude: currentPosition.coords.longitude,
              ...DEFAULT_DELTA,
            });
          } else {
            setRegion(FALLBACK_REGION);
          }
          setLoadingMap(false);
        }
      } catch (error) {
        console.error('Failed to load device location:', error);
        if (!cancelled) {
          setRegion(FALLBACK_REGION);
          setLoadingMap(false);
        }
      }
    };

    void loadInitialRegion();

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [deliveryLocation]);

  useEffect(() => {
    if (!region) {
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void resolveRegionAddress(region.latitude, region.longitude);
    }, 350);
  }, [region]);

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();

    if (trimmedQuery.length < 3) {
      setSearchingPlaces(false);
      setSearchSuggestions([]);
      return;
    }

    const timeoutId = setTimeout(() => {
      void searchPlaces(trimmedQuery);
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const resolveRegionAddress = async (latitude: number, longitude: number) => {
    setResolvingAddress(true);

    try {
      const result = await Location.reverseGeocodeAsync({ latitude, longitude });
      const { address, shortAddress } = formatDeliveryLocation(result[0] ?? null);

      setResolvedAddress(address || fallbackAddressFromCoords(latitude, longitude));
      setShortAddress(shortAddress);
    } catch (error) {
      console.error('Failed to reverse geocode location:', error);
      setResolvedAddress(fallbackAddressFromCoords(latitude, longitude));
      setShortAddress('Selected map pin');
    } finally {
      setResolvingAddress(false);
    }
  };

  const searchPlaces = async (query: string) => {
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearchingPlaces(true);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ng&addressdetails=1&limit=6&q=${encodeURIComponent(
          query
        )}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Place search failed with status ${response.status}`);
      }

      const payload = (await response.json()) as {
        place_id: number;
        lat: string;
        lon: string;
        display_name: string;
        address?: Record<string, string | undefined>;
      }[];

      if (searchRequestRef.current !== requestId) {
        return;
      }

      const nextSuggestions = payload.map((item) => {
        const address = item.address ?? {};
        const title =
          address.road ||
          address.neighbourhood ||
          address.suburb ||
          address.village ||
          address.town ||
          address.city ||
          address.county ||
          item.display_name.split(',')[0]?.trim() ||
          'Suggested place';
        const subtitle = [
          address.suburb,
          address.city || address.town || address.village,
          address.state,
        ]
          .filter(Boolean)
          .join(', ');

        return {
          id: String(item.place_id),
          latitude: Number(item.lat),
          longitude: Number(item.lon),
          title,
          subtitle: subtitle || item.display_name,
          displayName: item.display_name,
        } satisfies LocationSuggestion;
      });

      setSearchSuggestions(nextSuggestions);
    } catch (error) {
      console.error('Failed to search delivery places:', error);
      if (searchRequestRef.current === requestId) {
        setSearchSuggestions([]);
      }
    } finally {
      if (searchRequestRef.current === requestId) {
        setSearchingPlaces(false);
      }
    }
  };

  const handleSuggestionSelect = (suggestion: LocationSuggestion) => {
    const nextRegion = {
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      ...DEFAULT_DELTA,
    };

    setSearchQuery(suggestion.title);
    setSearchSuggestions([]);
    setRegion(nextRegion);
    setResolvedAddress(suggestion.displayName);
    setShortAddress(suggestion.title);
    mapRef.current?.animateToRegion(nextRegion, 450);
  };

  const handleUseCurrentLocation = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Location permission needed',
          'Allow location access so we can center the map around your delivery point.'
        );
        return;
      }

      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const nextRegion = {
        latitude: currentPosition.coords.latitude,
        longitude: currentPosition.coords.longitude,
        ...DEFAULT_DELTA,
      };

      setLocationPermissionDenied(false);
      setRegion(nextRegion);
      mapRef.current?.animateToRegion(nextRegion, 500);
    } catch (error) {
      console.error('Failed to fetch current location:', error);
      Alert.alert('Location unavailable', 'We could not refresh your current location right now.');
    }
  };

  const handleConfirmLocation = () => {
    if (!region) {
      Alert.alert('Location unavailable', 'Wait a moment for the map to finish loading.');
      return;
    }

    setDeliveryLocation({
      address: resolvedAddress,
      latitude: region.latitude,
      longitude: region.longitude,
      shortAddress,
    });

    router.replace('/cart');
  };

  if (loadingMap || !region) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f5b342" />
        <Text style={styles.loadingText}>Loading map and nearby delivery area...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={mapProvider}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={!locationPermissionDenied}
        showsMyLocationButton={false}
        onRegionChangeComplete={setRegion}
      />

      <View pointerEvents="none" style={styles.centerPinWrapper}>
        <View style={styles.pinShadow} />
        <View style={styles.pinCircle}>
          <FontAwesome name="map-marker" size={34} color="#ef4444" />
        </View>
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.topButton} onPress={() => router.replace('/cart')}>
          <FontAwesome name="arrow-left" size={18} color="#111" />
        </TouchableOpacity>
        <View style={styles.topMessage}>
          <Text style={styles.topTitle}>Pin your delivery spot</Text>
          <Text style={styles.topSubtitle}>Move the map until the pin sits on your doorstep.</Text>
          <View style={styles.searchWrapper}>
            <FontAwesome name="search" size={15} color="#9ca3af" style={styles.searchIcon} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search for a street, area, or landmark"
              placeholderTextColor="#9ca3af"
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
            />
          </View>
          {searchingPlaces ? <Text style={styles.searchStatus}>Searching nearby places...</Text> : null}
          {searchSuggestions.length ? (
            <View style={styles.searchDropdown}>
              {searchSuggestions.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion.id}
                  style={styles.searchSuggestion}
                  onPress={() => handleSuggestionSelect(suggestion)}
                >
                  <Text style={styles.searchSuggestionTitle}>{suggestion.title}</Text>
                  <Text style={styles.searchSuggestionCopy} numberOfLines={2}>
                    {suggestion.subtitle}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.recenterButton, { bottom: insets.bottom + 230 }]}
        onPress={handleUseCurrentLocation}
      >
        <FontAwesome name="location-arrow" size={18} color="#111" />
      </TouchableOpacity>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetEyebrow}>Delivery address</Text>
        <Text style={styles.sheetTitle}>{shortAddress}</Text>
        <Text style={styles.sheetDescription}>{resolvedAddress}</Text>

        {locationPermissionDenied ? (
          <View style={styles.permissionNotice}>
            <FontAwesome name="info-circle" size={16} color="#9a6700" />
            <Text style={styles.permissionText}>
              Location access is off, so we opened a default map area. Drag the map to your address or enable
              permissions and tap the arrow button.
            </Text>
          </View>
        ) : null}

        <View style={styles.sheetMetaRow}>
          <View style={styles.metaPill}>
            <FontAwesome name="crosshairs" size={14} color="#7a5b23" />
            <Text style={styles.metaPillText}>{resolvingAddress ? 'Refreshing address...' : 'Pin looks good'}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.confirmButton} onPress={handleConfirmLocation}>
          <Text style={styles.confirmButtonText}>Deliver here</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#eef2f4',
    flex: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    backgroundColor: '#fff',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#5b6470',
    fontSize: 15,
    marginTop: 14,
    textAlign: 'center',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    left: 16,
    position: 'absolute',
    right: 16,
    top: 0,
  },
  topButton: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    height: 40,
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    width: 40,
  },
  topMessage: {
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    borderRadius: 22,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  topTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  topSubtitle: {
    color: '#d1d5db',
    fontSize: 13,
    marginTop: 4,
  },
  searchWrapper: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    flexDirection: 'row',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    color: '#111827',
    flex: 1,
    fontSize: 14,
    minHeight: 40,
  },
  searchStatus: {
    color: '#d1d5db',
    fontSize: 12,
    marginTop: 8,
  },
  searchDropdown: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginTop: 10,
    overflow: 'hidden',
  },
  searchSuggestion: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchSuggestionTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  searchSuggestionCopy: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  centerPinWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '42%',
  },
  pinShadow: {
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
    borderRadius: 999,
    height: 12,
    marginBottom: -8,
    width: 34,
  },
  pinCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -18 }],
  },
  recenterButton: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    width: 44,
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    bottom: 0,
    left: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    position: 'absolute',
    right: 0,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#d9dde2',
    borderRadius: 999,
    height: 5,
    marginBottom: 16,
    width: 48,
  },
  sheetEyebrow: {
    color: '#8a6442',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sheetTitle: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
  },
  sheetDescription: {
    color: '#5b6470',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  permissionNotice: {
    backgroundColor: '#fff8e6',
    borderRadius: 16,
    flexDirection: 'row',
    marginTop: 16,
    padding: 14,
  },
  permissionText: {
    color: '#7c5d18',
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    marginLeft: 10,
  },
  sheetMetaRow: {
    flexDirection: 'row',
    marginTop: 16,
  },
  metaPill: {
    alignItems: 'center',
    backgroundColor: '#fff3d4',
    borderRadius: 999,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  metaPillText: {
    color: '#7a5b23',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: '#f5b342',
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
});
