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

const HIGH_ACCURACY_CONFIG = {
  accuracy: Location.Accuracy.Highest,
  mayShowUserSettingsDialog: true,
  timeInterval: 0,
};

const BALANCED_ACCURACY_CONFIG = {
  accuracy: Location.Accuracy.Balanced,
  mayShowUserSettingsDialog: true,
};

export class GoogleMapsLocationService {
  private static readonly GEOCODING_API_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
  private static readonly PLACES_API_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
  private static readonly PLACE_DETAILS_API_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

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

  static async reverseGeocode(
    latitude: number,
    longitude: number,
    apiKey: string
  ): Promise<ReverseGeocodeResult | null> {
    try {
      const response = await fetch(
        `${this.GEOCODING_API_URL}?latlng=${latitude},${longitude}&key=${apiKey}&language=en`
      );

      if (!response.ok) {
        throw new Error(`Geocoding API returned ${response.status}`);
      }

      const data = (await response.json()) as {
        results?: {
          formatted_address: string;
          address_components?: {
            long_name: string;
            short_name: string;
            types: string[];
          }[];
        }[];
      };

      const result = data.results?.[0];
      if (!result) {
        return null;
      }

      const addressComponents = result.address_components ?? [];
      const route = addressComponents.find((c) => c.types.includes('route'))?.long_name ?? '';
      const locality = addressComponents.find((c) => c.types.includes('locality'))?.long_name ?? '';
      const adminArea =
        addressComponents.find((c) => c.types.includes('administrative_area_level_1'))?.short_name ?? '';

      const shortAddress = [route, locality].filter(Boolean).join(', ') || locality || adminArea;

      return {
        address: result.formatted_address,
        shortAddress: shortAddress || result.formatted_address,
        coordinates: { latitude, longitude },
      };
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      return null;
    }
  }

  static async searchPlaces(query: string, apiKey: string, sessionToken?: string): Promise<PlacePrediction[]> {
    if (!query.trim() || query.length < 2) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        input: query,
        key: apiKey,
        language: 'en',
        components: 'country:ng',
      });

      if (sessionToken) {
        params.append('sessiontoken', sessionToken);
      }

      const response = await fetch(`${this.PLACES_API_URL}?${params}`);

      if (!response.ok) {
        throw new Error(`Places API returned ${response.status}`);
      }

      const data = (await response.json()) as {
        predictions?: {
          place_id: string;
          description: string;
          main_text: string;
          secondary_text?: string;
        }[];
      };

      return (data.predictions ?? []).map((prediction) => ({
        placeId: prediction.place_id,
        description: prediction.description,
        mainText: prediction.main_text,
        secondaryText: prediction.secondary_text,
      }));
    } catch (error) {
      console.error('Place search failed:', error);
      return [];
    }
  }

  static async getPlaceDetails(placeId: string, apiKey: string, sessionToken?: string): Promise<PlaceDetails | null> {
    try {
      const params = new URLSearchParams({
        place_id: placeId,
        key: apiKey,
        language: 'en',
        fields: 'geometry,formatted_address,name',
      });

      if (sessionToken) {
        params.append('sessiontoken', sessionToken);
      }

      const response = await fetch(`${this.PLACE_DETAILS_API_URL}?${params}`);

      if (!response.ok) {
        throw new Error(`Place Details API returned ${response.status}`);
      }

      const data = (await response.json()) as {
        result?: {
          geometry?: { location?: { lat: number; lng: number } };
          formatted_address?: string;
          name?: string;
        };
      };

      const result = data.result;
      if (!result?.geometry?.location) {
        return null;
      }

      return {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        name: result.name ?? '',
        formattedAddress: result.formatted_address ?? '',
      };
    } catch (error) {
      console.error('Failed to fetch place details:', error);
      return null;
    }
  }

  static calculateDistance(
    coord1: LocationCoordinates,
    coord2: LocationCoordinates
  ): number {
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

  static calculateMapRegionBounds(
    coordinates: LocationCoordinates[],
    paddingPercent: number = 0.15
  ) {
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
