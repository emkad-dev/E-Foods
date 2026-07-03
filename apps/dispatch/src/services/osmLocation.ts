import * as Location from 'expo-location';

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
}

export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText?: string;
}

export interface PlaceDetails {
  latitude: number;
  longitude: number;
  name: string;
  formattedAddress: string;
}

export interface ReverseGeocodeResult {
  address: string;
  shortAddress: string;
  coordinates: LocationCoordinates;
}

type NominatimAddress = {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  country?: string;
  display_name?: string;
};

type NominatimSearchResult = {
  lat: string;
  lon: string;
  display_name: string;
  osm_id: number;
  osm_type: 'node' | 'way' | 'relation';
  address?: NominatimAddress;
};

const HIGH_ACCURACY_CONFIG = {
  accuracy: Location.Accuracy.Highest,
  mayShowUserSettingsDialog: true,
  timeInterval: 0,
};

const BALANCED_ACCURACY_CONFIG = {
  accuracy: Location.Accuracy.Balanced,
  mayShowUserSettingsDialog: true,
};

const NOMINATIM_USER_AGENT = 'FEASTY/1.0 (support@feasty.com)';
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

const joinParts = (parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');

const buildShortAddress = (address: NominatimAddress | undefined, fallback: string) =>
  joinParts([
    address?.road ?? address?.pedestrian ?? address?.footway ?? address?.path,
    address?.suburb ?? address?.city ?? address?.town ?? address?.village ?? address?.county,
  ]) || fallback;

const buildFullAddress = (address: NominatimAddress | undefined, fallback: string) =>
  joinParts([
    address?.house_number && address?.road ? `${address.house_number} ${address.road}` : address?.road,
    address?.suburb,
    address?.city ?? address?.town ?? address?.village,
    address?.county,
    address?.state,
    address?.country,
  ]) || fallback;

const getHeaders = () => ({
  Accept: 'application/json',
  'Accept-Language': 'en',
  'User-Agent': NOMINATIM_USER_AGENT,
});

const normalizeOsmType = (value: NominatimSearchResult['osm_type']) => {
  switch (value) {
    case 'node':
      return 'N';
    case 'way':
      return 'W';
    case 'relation':
      return 'R';
    default:
      return 'N';
  }
};

export class OpenStreetMapLocationService {
  private static async withTimeout<T>(work: Promise<T>, timeoutMs = 15000): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      return await Promise.race([
        work,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error('Location request timed out.'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  static async requestLocationPermission(): Promise<boolean> {
    const permission = await Location.requestForegroundPermissionsAsync();
    return permission.granted;
  }

  static async getCurrentLocationHighAccuracy(
    options?: { timeout?: number; maxAge?: number }
  ): Promise<LocationCoordinates | null> {
    try {
      const maxAge = options?.maxAge ?? 0;
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge,
      });

      if (lastKnown) {
        return {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
        };
      }

      const position = await this.withTimeout(
        Location.getCurrentPositionAsync(HIGH_ACCURACY_CONFIG),
        options?.timeout ?? 15000
      );

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch (error) {
      console.error('Failed to get current location with high accuracy:', error);
      return null;
    }
  }

  static async getLastKnownLocation(): Promise<LocationCoordinates | null> {
    try {
      const position = await Location.getLastKnownPositionAsync();
      if (!position) {
        return null;
      }

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch (error) {
      console.error('Failed to get last known location:', error);
      return null;
    }
  }

  static async getCurrentLocationBalanced(): Promise<LocationCoordinates | null> {
    try {
      const position = await Location.getCurrentPositionAsync(BALANCED_ACCURACY_CONFIG);

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch (error) {
      console.error('Failed to get current location with balanced accuracy:', error);
      return null;
    }
  }

  static async reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodeResult | null> {
    try {
      const params = new URLSearchParams({
        addressdetails: '1',
        format: 'jsonv2',
        lat: String(latitude),
        lon: String(longitude),
        'accept-language': 'en',
      });

      const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params}`, {
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Reverse geocoding returned ${response.status}`);
      }

      const data = (await response.json()) as {
        address?: NominatimAddress;
        display_name?: string;
      };

      const displayName = data.display_name ?? '';
      const address = data.address ?? {};
      const shortAddress = buildShortAddress(address, displayName || 'Pinned location');

      return {
        address: buildFullAddress(address, displayName || shortAddress),
        shortAddress,
        coordinates: { latitude, longitude },
      };
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      return null;
    }
  }

  static async searchPlaces(query: string): Promise<PlacePrediction[]> {
    if (!query.trim() || query.trim().length < 2) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        addressdetails: '1',
        countrycodes: 'ng',
        format: 'jsonv2',
        limit: '8',
        q: query.trim(),
        'accept-language': 'en',
      });

      const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params}`, {
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Place search returned ${response.status}`);
      }

      const data = (await response.json()) as NominatimSearchResult[];

      return data.map((item) => {
        const address = item.address ?? {};
        const mainText =
          address.road ??
          address.pedestrian ??
          address.footway ??
          address.path ??
          item.display_name.split(',')[0]?.trim() ??
          query.trim();
        const secondaryText = buildShortAddress(address, item.display_name);

        return {
          placeId: `${normalizeOsmType(item.osm_type)}:${item.osm_id}`,
          description: item.display_name,
          mainText,
          secondaryText,
        };
      });
    } catch (error) {
      console.error('Place search failed:', error);
      return [];
    }
  }

  static async getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
    try {
      const [typeCode, osmId] = placeId.split(':');
      const normalizedId = osmId?.trim();
      if (!typeCode || !normalizedId) {
        return null;
      }

      const params = new URLSearchParams({
        addressdetails: '1',
        format: 'jsonv2',
        osm_ids: `${typeCode}${normalizedId}`,
        'accept-language': 'en',
      });

      const response = await fetch(`${NOMINATIM_BASE_URL}/lookup?${params}`, {
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Place lookup returned ${response.status}`);
      }

      const data = (await response.json()) as NominatimSearchResult[];
      const result = data[0];
      if (!result) {
        return null;
      }

      return {
        latitude: Number.parseFloat(result.lat),
        longitude: Number.parseFloat(result.lon),
        name: result.display_name.split(',')[0]?.trim() ?? '',
        formattedAddress: result.display_name,
      };
    } catch (error) {
      console.error('Failed to fetch place details:', error);
      return null;
    }
  }

  static calculateDistance(coord1: LocationCoordinates, coord2: LocationCoordinates): number {
    const R = 6371;
    const dLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
    const dLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((coord1.latitude * Math.PI) / 180) *
        Math.cos((coord2.latitude * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  static calculateMapRegionBounds(coordinates: LocationCoordinates[], paddingPercent: number = 0.15) {
    if (coordinates.length === 0) {
      return null;
    }

    if (coordinates.length === 1) {
      return {
        latitude: coordinates[0].latitude,
        longitude: coordinates[0].longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }

    const latitudes = coordinates.map((c) => c.latitude);
    const longitudes = coordinates.map((c) => c.longitude);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);

    const latDiff = maxLat - minLat;
    const lonDiff = maxLon - minLon;

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: latDiff * (1 + paddingPercent),
      longitudeDelta: lonDiff * (1 + paddingPercent),
    };
  }
}
