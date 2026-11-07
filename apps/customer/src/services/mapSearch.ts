/**
 * The order of the one-shot "Search the map" fallback, kept free of
 * `react-native` and `expo-location` so it can be tested with `node --test`.
 * services/addressSearch.ts supplies the real device geocoder and Nominatim.
 *
 * Order: on Android, the phone's own geocoder first (it costs nothing and sends
 * nothing to OpenStreetMap), then Nominatim. Everywhere else, Nominatim alone.
 * Nominatim is asked at most once per press, which is what its policy allows.
 */
import type { AddressSuggestion } from '../../../../packages/runtime/src/addressSearch.ts';
import type { AddressLookupOutcome } from '../../../../packages/runtime/src/nominatimSearch.ts';
import { isUsableCoordinatePair } from '../../../../packages/domain/src/restaurantLocation.ts';

export type MapSearchResult = { kind: 'results'; results: AddressSuggestion[] } | { kind: 'failed' };

export const MAP_SEARCH_MAX_RESULTS = 5;

/** Identifies the customer app to Nominatim on native, as its usage policy asks. */
export const CUSTOMER_NOMINATIM_USER_AGENT = 'FEASTY/1.0 (https://feasty.com.ng)';

export type DeviceGeocodePoint = { latitude: number; longitude: number };

export type MapSearchDeps = {
  /** Only provided on Android native. Throws or returns [] when it has nothing. */
  deviceGeocode?: (query: string) => Promise<DeviceGeocodePoint[]>;
  nominatim: (query: string) => Promise<AddressLookupOutcome>;
};

/**
 * The device geocoder is not limited to Nigeria the way the Nominatim request
 * is (countrycodes=ng), so a bare street name could resolve abroad. Naming the
 * country biases it home without changing a query that already says it.
 */
export const toDeviceGeocodeQuery = (query: string): string => {
  const trimmed = query.replace(/\s+/g, ' ').trim();
  return /\bnigeria\b/i.test(trimmed) ? trimmed : `${trimmed}, Nigeria`;
};

/**
 * Device-geocoder points carry no place name, so each is labelled with the text
 * that found it; the screen still shows it as a match to tap, never as a pin
 * set behind the customer's back.
 */
export const fromDevicePoints = (query: string, points: DeviceGeocodePoint[]): AddressSuggestion[] => {
  const label = query.replace(/\s+/g, ' ').trim();
  return points
    .filter((point) => isUsableCoordinatePair(point?.latitude, point?.longitude))
    .slice(0, MAP_SEARCH_MAX_RESULTS)
    .map((point) => ({ label, latitude: point.latitude, longitude: point.longitude }));
};

/** `no-result` is an answer (nothing there); every other failure is the service not answering. */
export const fromNominatimOutcome = (outcome: AddressLookupOutcome): MapSearchResult => {
  if (outcome.kind === 'found') {
    return {
      kind: 'results',
      results: outcome.matches.slice(0, MAP_SEARCH_MAX_RESULTS).map((match) => ({
        label: match.placeName,
        latitude: match.latitude,
        longitude: match.longitude,
      })),
    };
  }

  return outcome.kind === 'no-result' ? { kind: 'results', results: [] } : { kind: 'failed' };
};

export const runMapSearch = async (query: string, { deviceGeocode, nominatim }: MapSearchDeps): Promise<MapSearchResult> => {
  if (deviceGeocode) {
    try {
      const fromDevice = fromDevicePoints(query, await deviceGeocode(toDeviceGeocodeQuery(query)));
      if (fromDevice.length > 0) {
        return { kind: 'results', results: fromDevice };
      }
    } catch {
      // The device geocoder is an extra attempt; its failure just moves on.
    }
  }

  try {
    return fromNominatimOutcome(await nominatim(query));
  } catch {
    return { kind: 'failed' };
  }
};
