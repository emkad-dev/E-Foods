/**
 * The one-shot OpenStreetMap Nominatim forward search, shared by the partner
 * app (Find from address) and the customer app (Search the map, the fallback
 * when the suggestion Worker is unavailable). Moved here from
 * apps/partner/src/domain/addressLookup.ts so the two apps run one
 * implementation; the partner module re-exports what its screen and tests use.
 *
 * Platform-free: no `react-native`. The caller passes its identifying
 * User-Agent on native and nothing on web (browsers refuse to let a page set
 * it and send the page origin as Referer instead), and a reporter for faults.
 *
 * ONE REQUEST PER BUTTON PRESS, NEVER AS SOMEONE TYPES. Nominatim's usage
 * policy forbids autocomplete-style traffic and allows at most one request a
 * second; `findAddressMatches` spaces consecutive calls to respect that.
 */
import { isUsableCoordinatePair } from '../../domain/src/restaurantLocation.ts';

export type AddressMatch = {
  latitude: number;
  longitude: number;
  /** What Nominatim called the place, so the person can see what was matched. */
  placeName: string;
};

/** How a forward search ended. Only 'found' carries places; `match` is the first of `matches`. */
export type AddressLookupOutcome =
  | { kind: 'found'; match: AddressMatch; matches: AddressMatch[] }
  | { kind: 'no-result' }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'unavailable' };

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/** A slow geocoder must not leave the button spinning for ever. */
export const ADDRESS_LOOKUP_TIMEOUT_MS = 8000;

/** The policy allows at most one request a second; leave a little margin. */
export const ADDRESS_LOOKUP_MIN_INTERVAL_MS = 1100;

/** Nominatim answers at most this many per request; the screens show at most five. */
const MAX_MATCHES = 5;

/** Shorter than this is a typo, not an address worth a request. */
export const NOMINATIM_MIN_QUERY_LENGTH = 4;

const MAX_PLACE_NAME_LENGTH = 200;

/**
 * Restaurants and customers on the platform are in Nigeria, and without the
 * restriction a short street name resolves to a namesake on another continent.
 */
const COUNTRY_CODES = 'ng';

/** `null` when there is nothing worth looking up. */
export const normalizeAddressQuery = (address: string): string | null => {
  const collapsed = address.replace(/\s+/g, ' ').trim();
  return collapsed.length >= NOMINATIM_MIN_QUERY_LENGTH ? collapsed : null;
};

const clampMatches = (limit: number | undefined): number =>
  typeof limit === 'number' && Number.isFinite(limit) ? Math.min(MAX_MATCHES, Math.max(1, Math.floor(limit))) : 1;

export const buildAddressSearchUrl = (query: string, limit = 1): string => {
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: String(clampMatches(limit)),
    countrycodes: COUNTRY_CODES,
    'accept-language': 'en',
    q: query,
  });

  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
};

/** Nominatim sends coordinates as strings; anything else non-numeric is rejected. */
const coordinateOf = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const placeNameOf = (entry: Record<string, unknown>): string | null => {
  for (const candidate of [entry.display_name, entry.name]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim().slice(0, MAX_PLACE_NAME_LENGTH);
    }
  }

  return null;
};

/**
 * The usable results of a Nominatim `search` response, in order, at most `limit`.
 *
 * Takes `unknown` because it parses a network payload: an HTML error page, a
 * JSON object where an array was expected, or entries missing a field all come
 * back as "no match" rather than as a throw or a pin at 0,0. An entry is usable
 * only when it has a name to show AND a coordinate pair the server would accept,
 * so a match can never be one the Save would then be refused over.
 */
export const parseGeocodeMatches = (payload: unknown, limit = 1): AddressMatch[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  const max = clampMatches(limit);
  const matches: AddressMatch[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const latitude = coordinateOf(record.lat);
    const longitude = coordinateOf(record.lon);
    const placeName = placeNameOf(record);

    if (placeName && latitude !== null && longitude !== null && isUsableCoordinatePair(latitude, longitude)) {
      matches.push({ latitude, longitude, placeName });

      if (matches.length >= max) {
        break;
      }
    }
  }

  return matches;
};

/** First usable result of a Nominatim `search` response, or null. */
export const parseGeocodeResults = (payload: unknown): AddressMatch | null => parseGeocodeMatches(payload, 1)[0] ?? null;

/**
 * How a finished request maps onto an outcome, kept apart from `fetch` so the
 * mapping can be tested. A non-2xx (429 rate limit, 5xx) is the service not
 * answering usefully; a parsed body with no usable entry is simply no result.
 */
export const outcomeFromResponse = (ok: boolean, payload: unknown, limit = 1): AddressLookupOutcome => {
  if (!ok) {
    return { kind: 'unavailable' };
  }

  const matches = parseGeocodeMatches(payload, limit);
  return matches.length > 0 ? { kind: 'found', match: matches[0]!, matches } : { kind: 'no-result' };
};

/**
 * `aborted` is whether our own timeout fired. fetch rejects with a TypeError for a
 * transport failure (no network, DNS, blocked); anything else, such as a
 * malformed body, is the service misbehaving.
 */
export const outcomeFromLookupError = (error: unknown, aborted: boolean): AddressLookupOutcome => {
  if (aborted) {
    return { kind: 'timeout' };
  }

  return error instanceof TypeError ? { kind: 'offline' } : { kind: 'unavailable' };
};

export type FindAddressMatchesOptions = {
  /** Native only: the app's identifying User-Agent. Leave unset on web. */
  userAgent?: string;
  /** How many matches to ask for (1 to 5). Defaults to 1. */
  limit?: number;
  /** Called for a fault worth reporting; timeouts and no-network are expected and are not. */
  onUnexpectedError?: (error: unknown) => void;
  fetchImpl?: typeof fetch;
  /** Injected by tests so the one-second spacing is checked without really waiting. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

let lastLookupStartedAt = 0;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Forward-geocodes a typed address with OpenStreetMap Nominatim. Never throws:
 * every way it can go wrong is an outcome the screen words for the person.
 */
export const findAddressMatches = async (
  address: string,
  { userAgent, limit = 1, onUnexpectedError, fetchImpl, now = Date.now, sleep = realSleep }: FindAddressMatchesOptions = {}
): Promise<AddressLookupOutcome> => {
  const query = normalizeAddressQuery(address);

  if (!query) {
    return { kind: 'no-result' };
  }

  // At most one request a second. A button cannot be double-pressed while a
  // lookup is in flight, but two quick lookups in a row can still land inside a
  // second of each other.
  const waitMs = lastLookupStartedAt + ADDRESS_LOOKUP_MIN_INTERVAL_MS - now();
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastLookupStartedAt = now();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), ADDRESS_LOOKUP_TIMEOUT_MS);

  try {
    const doFetch = fetchImpl ?? fetch;
    const response = await doFetch(buildAddressSearchUrl(query, limit), {
      headers: {
        Accept: 'application/json',
        ...(userAgent ? { 'User-Agent': userAgent } : {}),
      },
      signal: controller.signal,
    });

    return outcomeFromResponse(response.ok, response.ok ? await response.json() : null, limit);
  } catch (error) {
    const outcome = outcomeFromLookupError(error, controller.signal.aborted);

    if (outcome.kind === 'unavailable') {
      onUnexpectedError?.(error);
    }

    return outcome;
  } finally {
    clearTimeout(timeoutHandle);
  }
};
