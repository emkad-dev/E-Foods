/**
 * The customer app's bindings for address search: the shared Worker client
 * with this app's configured URL, and the one-shot "Search the map" fallback
 * with this app's User-Agent and, on Android, the phone's own geocoder.
 * The order and parsing live in services/mapSearch.ts, which is tested.
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import {
  resolveGeocodeBaseUrl,
  searchAddresses as searchWorker,
  type AddressSearchResult,
} from '../../../../packages/runtime/src/addressSearch.ts';
import { findAddressMatches } from '../../../../packages/runtime/src/nominatimSearch.ts';
import { reportError } from '../../../../packages/observability/src/sentry';
import { appEnv } from '../config/env';
import {
  CUSTOMER_NOMINATIM_USER_AGENT,
  MAP_SEARCH_MAX_RESULTS,
  runMapSearch,
  type MapSearchResult,
} from './mapSearch';

const geocodeBaseUrl = resolveGeocodeBaseUrl(appEnv.geocodeUrl);

/** Suggestions while the customer types. Resolves to `unavailable` on any failure. */
export const searchAddresses = (query: string, options: { signal: AbortSignal }): Promise<AddressSearchResult> =>
  searchWorker(query, { signal: options.signal, baseUrl: geocodeBaseUrl });

/** One press of "Search the map". */
export const searchTheMap = (query: string): Promise<MapSearchResult> =>
  runMapSearch(query, {
    // Android only (expo-location has no geocoder on web). It is an extra
    // attempt before Nominatim, not a replacement for it.
    deviceGeocode:
      Platform.OS === 'android' ? (deviceQuery) => Location.geocodeAsync(deviceQuery) : undefined,
    nominatim: (nominatimQuery) =>
      findAddressMatches(nominatimQuery, {
        limit: MAP_SEARCH_MAX_RESULTS,
        // Browsers refuse to let a page set User-Agent and send the page's own
        // origin as Referer, which identifies the app to Nominatim instead.
        userAgent: Platform.OS === 'web' ? undefined : CUSTOMER_NOMINATIM_USER_AGENT,
        onUnexpectedError: (error) => reportError('customer.searchTheMap', error),
      }),
  });
