/**
 * Address suggestions from the FEASTY geocode Worker (`cloudflare/geocode`),
 * shared by the customer and partner apps.
 *
 * Platform-free on purpose (no `react-native`, no `expo-*`): it is `fetch` and
 * parsing only, so Node's test runner exercises the real code, and the apps pass
 * in their own base URL from their public config.
 *
 * THE RESULT NEVER THROWS. Every way the Worker can fail to help (a non-200, a
 * timeout, no network, a body that is not the contract) collapses into one
 * `unavailable` signal, because the screen does the same thing for all of them:
 * offer the one-shot "Search the map" fallback. The Worker itself returns 503
 * when it is switched off, which lands here too, so turning the provider off
 * never needs an app update.
 */
import { isUsableCoordinatePair } from '../../domain/src/restaurantLocation.ts';

export const DEFAULT_GEOCODE_URL = 'https://geo.feasty.com.ng';

/** Slower than this and a suggestion arrives after the customer has stopped looking for it. */
export const ADDRESS_SEARCH_TIMEOUT_MS = 4000;

/** The Worker's own bounds (`cloudflare/geocode/src/query.ts`); a query outside them is a 400. */
export const ADDRESS_SEARCH_MIN_LENGTH = 3;
export const ADDRESS_SEARCH_MAX_LENGTH = 120;
export const ADDRESS_SEARCH_MAX_RESULTS = 5;

/** The licence asks for visible credit wherever OpenStreetMap-derived results are shown. */
export const OSM_CONTRIBUTORS_ATTRIBUTION = '© OpenStreetMap contributors';

const MAX_LABEL_LENGTH = 200;

export type AddressSuggestion = {
  label: string;
  latitude: number;
  longitude: number;
};

/**
 * `aborted` is the caller cancelling (the query changed), not the service
 * failing, so a screen must ignore it rather than offer the fallback.
 */
export type AddressSearchUnavailableReason = 'aborted' | 'http' | 'invalid' | 'network' | 'timeout';

export type AddressSearchResult =
  | { kind: 'results'; results: AddressSuggestion[] }
  | { kind: 'unavailable'; reason: AddressSearchUnavailableReason };

export type AddressSearchOptions = {
  signal?: AbortSignal;
  /** The Worker origin; see `resolveGeocodeBaseUrl`. */
  baseUrl?: string;
  limit?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * The value of `EXPO_PUBLIC_GEOCODE_URL`, or the production Worker when it is
 * unset or is not an http(s) URL. A trailing slash is dropped so the path join
 * cannot produce `//search`.
 */
export const resolveGeocodeBaseUrl = (value: string | null | undefined): string => {
  const trimmed = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  return /^https?:\/\/[^\s/]+/i.test(trimmed) ? trimmed : DEFAULT_GEOCODE_URL;
};

/**
 * The query worth sending, or null when there is none yet. Whitespace is
 * collapsed so "  Bodija   Market " and "Bodija Market" are one query, and an
 * over-long paste is cut to the Worker's limit instead of being refused by it.
 */
export const normalizeSearchQuery = (text: string): string | null => {
  const collapsed = text.replace(/\s+/g, ' ').trim();

  if (collapsed.length < ADDRESS_SEARCH_MIN_LENGTH) {
    return null;
  }

  return collapsed.slice(0, ADDRESS_SEARCH_MAX_LENGTH).trim();
};

const clampLimit = (limit: number | undefined): number => {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return ADDRESS_SEARCH_MAX_RESULTS;
  }

  return Math.min(ADDRESS_SEARCH_MAX_RESULTS, Math.max(1, Math.floor(limit)));
};

export const buildAddressSearchRequestUrl = (baseUrl: string, query: string, limit?: number): string => {
  const params = new URLSearchParams({ q: query, limit: String(clampLimit(limit)) });
  return `${resolveGeocodeBaseUrl(baseUrl)}/search?${params.toString()}`;
};

/**
 * The suggestions in a Worker response, or null when the body is not the
 * contract. Entries without a label or with a coordinate pair the rest of the
 * platform would refuse (0,0, out of range, non-numeric) are dropped rather
 * than shown, so a suggestion can never become a pin that is then rejected.
 */
export const parseAddressSuggestions = (payload: unknown, limit?: number): AddressSuggestion[] | null => {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
    return null;
  }

  const max = clampLimit(limit);
  const suggestions: AddressSuggestion[] = [];

  for (const entry of (payload as { results: unknown[] }).results) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const { label, latitude, longitude } = entry as Record<string, unknown>;

    if (typeof label !== 'string' || label.trim() === '' || !isUsableCoordinatePair(latitude, longitude)) {
      continue;
    }

    suggestions.push({
      label: label.trim().slice(0, MAX_LABEL_LENGTH),
      latitude: latitude as number,
      longitude: longitude as number,
    });

    if (suggestions.length >= max) {
      break;
    }
  }

  return suggestions;
};

/**
 * One suggestion request. Resolves, never rejects. A query too short to send
 * resolves to no results without touching the network.
 */
export const searchAddresses = async (
  query: string,
  { signal, baseUrl, limit, timeoutMs = ADDRESS_SEARCH_TIMEOUT_MS, fetchImpl }: AddressSearchOptions = {}
): Promise<AddressSearchResult> => {
  const normalized = normalizeSearchQuery(query);

  if (!normalized) {
    return { kind: 'results', results: [] };
  }

  if (signal?.aborted) {
    return { kind: 'unavailable', reason: 'aborted' };
  }

  // One controller for both reasons to stop, so whichever comes first wins and
  // the reason is still known afterwards.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    const doFetch = fetchImpl ?? fetch;
    const response = await doFetch(buildAddressSearchRequestUrl(baseUrl ?? DEFAULT_GEOCODE_URL, normalized, limit), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (response.status !== 200) {
      return { kind: 'unavailable', reason: 'http' };
    }

    const suggestions = parseAddressSuggestions(await response.json(), limit);
    return suggestions ? { kind: 'results', results: suggestions } : { kind: 'unavailable', reason: 'invalid' };
  } catch (error) {
    if (signal?.aborted) {
      return { kind: 'unavailable', reason: 'aborted' };
    }

    if (timedOut) {
      return { kind: 'unavailable', reason: 'timeout' };
    }

    // fetch rejects with a TypeError for a transport failure; anything else here
    // is a body that would not parse.
    return { kind: 'unavailable', reason: error instanceof TypeError ? 'network' : 'invalid' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
};
