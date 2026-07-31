import * as Location from 'expo-location';
import { Platform } from 'react-native';
import {
  acquireBrowserCoordinates,
  browserPositionErrorReason,
  buildNominatimAddress,
  joinAddressParts,
  locationFailure,
  type BrowserPositionOptions,
  type Coordinates,
  type CoordinatesResult,
  type LocationErrorReason,
  type NominatimReverseResponse,
  type ResolvedAddress,
} from './locationResolution';

export type { Coordinates, CoordinatesResult, LocationErrorReason, ResolvedAddress };

export type LocationWatch = {
  remove: () => void;
};

const NATIVE_TIMEOUT_MS = 15000;
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const NOMINATIM_TIMEOUT_MS = 8000;

const browserGeolocation = () => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return null;
  }

  return navigator.geolocation;
};

const requestBrowserPosition = (options: BrowserPositionOptions) =>
  new Promise<CoordinatesResult>((resolve) => {
    const geolocation = browserGeolocation();

    if (!geolocation) {
      resolve(locationFailure('unsupported'));
      return;
    }

    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          coordinates: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
        }),
      (positionError) => resolve(locationFailure(browserPositionErrorReason(positionError?.code))),
      options
    );
  });

const withTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T | 'timed-out'> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work,
      new Promise<'timed-out'>((resolve) => {
        timeoutHandle = setTimeout(() => resolve('timed-out'), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const getNativeCoordinates = async (): Promise<CoordinatesResult> => {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (!permission.granted) {
      return locationFailure('permission-denied');
    }

    const position = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: true,
      }),
      NATIVE_TIMEOUT_MS
    );

    if (position === 'timed-out') {
      return locationFailure('timeout');
    }

    return {
      ok: true,
      coordinates: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
    };
  } catch (error) {
    console.error('Failed to read the current position:', error);
    return locationFailure('unavailable');
  }
};

/**
 * On web the browser prompts for access the first time a fix is requested, so this single
 * entry point covers both the permission prompt and the fix itself.
 */
export const getCurrentCoordinates = async (): Promise<CoordinatesResult> =>
  Platform.OS === 'web' ? acquireBrowserCoordinates(requestBrowserPosition) : getNativeCoordinates();

/**
 * expo-location's web module routes watch events through its own id counter rather than the
 * browser's watch id, which can cancel a watch the moment it emits. Talk to
 * `navigator.geolocation` directly on web and keep expo-location for native.
 */
export const watchCoordinates = async (
  onChange: (coordinates: Coordinates) => void,
  onError?: (reason: LocationErrorReason) => void
): Promise<LocationWatch | null> => {
  if (Platform.OS === 'web') {
    const geolocation = browserGeolocation();

    if (!geolocation) {
      onError?.('unsupported');
      return null;
    }

    const watchId = geolocation.watchPosition(
      (position) =>
        onChange({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (positionError) => onError?.(browserPositionErrorReason(positionError?.code)),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );

    return {
      remove: () => geolocation.clearWatch(watchId),
    };
  }

  try {
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 10,
        timeInterval: 5000,
      },
      (position) =>
        onChange({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
    );

    return {
      remove: () => subscription.remove(),
    };
  } catch (error) {
    console.error('Failed to watch the current position:', error);
    onError?.('unavailable');
    return null;
  }
};

const reverseGeocodeWithOpenStreetMap = async (
  latitude: number,
  longitude: number
): Promise<ResolvedAddress | null> => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      addressdetails: '1',
      format: 'jsonv2',
      lat: String(latitude),
      lon: String(longitude),
      'accept-language': 'en',
    });

    const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Reverse geocoding returned ${response.status}`);
    }

    return buildNominatimAddress((await response.json()) as NominatimReverseResponse);
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

/**
 * expo-location cannot reverse geocode on web at all (it throws `E_NO_GEOCODER`), so web goes
 * straight to the OpenStreetMap service the rest of the platform already uses.
 */
export const reverseGeocode = async (latitude: number, longitude: number): Promise<ResolvedAddress | null> => {
  if (Platform.OS !== 'web') {
    try {
      const [geocoded] = await Location.reverseGeocodeAsync({ latitude, longitude });

      if (geocoded) {
        const street = geocoded.street ?? geocoded.name;
        const shortAddress = joinAddressParts([street, geocoded.city ?? geocoded.subregion]);
        const address = joinAddressParts([
          geocoded.streetNumber && geocoded.street ? `${geocoded.streetNumber} ${geocoded.street}` : street,
          geocoded.district,
          geocoded.city,
          geocoded.region,
          geocoded.country,
        ]);

        if (address || shortAddress) {
          return {
            address: address || shortAddress,
            shortAddress: shortAddress || address,
          };
        }
      }
    } catch (error) {
      console.error('Native reverse geocoding failed, falling back to OpenStreetMap:', error);
    }
  }

  return reverseGeocodeWithOpenStreetMap(latitude, longitude);
};
