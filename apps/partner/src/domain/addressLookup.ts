/**
 * The pure half of the two ways a partner can set the store's map pin: find it
 * from the typed address (OpenStreetMap Nominatim) or read it from the device.
 * Request building, response parsing, the wording of every confirmation and
 * every failure. No React Native, no `fetch`, no `expo-location`, so all of it
 * is testable with `node --test`; the I/O lives in services/deviceLocation.ts.
 *
 * WHY EVERYTHING IS CONFIRMED BEFORE IT FILLS A FIELD. Nominatim often resolves
 * a Nigerian address only to the area (a ward, a suburb) and puts the pin
 * kilometres from the door. A pin that was silently dropped into the fields
 * would look just as authoritative as a surveyed one, and customers are matched
 * to restaurants by distance from it. So the matched place name is shown first,
 * with the caveat, and nothing is written until the partner agrees.
 */
import { isUsableCoordinatePair } from '../../../../packages/domain/src/restaurantLocation.ts';

export type AddressMatch = {
  latitude: number;
  longitude: number;
  /** What Nominatim called the place, so the partner can see what was matched. */
  placeName: string;
};

export type DevicePosition = {
  latitude: number;
  longitude: number;
  /** Metres, when the device reports it. */
  accuracyMeters: number | null;
};

/** How a forward geocode ended. Only 'found' carries a place. */
export type AddressLookupOutcome =
  | { kind: 'found'; match: AddressMatch }
  | { kind: 'no-result' }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'unavailable' };

export type DevicePositionFailure = 'permission-denied' | 'timeout' | 'unavailable' | 'unsupported';

export type DevicePositionOutcome =
  | { kind: 'found'; position: DevicePosition }
  | { kind: DevicePositionFailure };

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * Nominatim's usage policy requires the application to identify itself with a
 * User-Agent (or Referer) that is not a library default. Native sends this;
 * browsers refuse to let a page set User-Agent and send the page's own origin as
 * Referer instead, which identifies the app just as well.
 */
export const NOMINATIM_USER_AGENT = 'FEASTY-Partner/1.0 (support@feasty.com.ng)';

/** A slow geocoder must not leave the button spinning for ever. */
export const ADDRESS_LOOKUP_TIMEOUT_MS = 8000;

/** The policy allows at most one request a second; leave a little margin. */
export const ADDRESS_LOOKUP_MIN_INTERVAL_MS = 1100;

/** Shorter than this is a typo, not an address worth a request. */
const MIN_ADDRESS_LENGTH = 4;

const MAX_PLACE_NAME_LENGTH = 200;

/**
 * Restaurants on the platform are in Nigeria, and without the restriction a
 * short street name resolves to a namesake on another continent.
 */
const COUNTRY_CODES = 'ng';

/** `null` when there is nothing worth looking up. */
export const normalizeAddressQuery = (address: string): string | null => {
  const collapsed = address.replace(/\s+/g, ' ').trim();
  return collapsed.length >= MIN_ADDRESS_LENGTH ? collapsed : null;
};

export const buildAddressSearchUrl = (query: string): string => {
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
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
 * First usable result of a Nominatim `search` response, or null.
 *
 * Takes `unknown` because it parses a network payload: an HTML error page, a
 * JSON object where an array was expected, or entries missing a field all come
 * back as "no match" rather than as a throw or a pin at 0,0. An entry is usable
 * only when it has a name to show AND a coordinate pair the server would accept,
 * so a match can never be one the Save would then be refused over.
 */
export const parseGeocodeResults = (payload: unknown): AddressMatch | null => {
  if (!Array.isArray(payload)) {
    return null;
  }

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const latitude = coordinateOf(record.lat);
    const longitude = coordinateOf(record.lon);
    const placeName = placeNameOf(record);

    if (placeName && latitude !== null && longitude !== null && isUsableCoordinatePair(latitude, longitude)) {
      return { latitude, longitude, placeName };
    }
  }

  return null;
};

/** What goes into the text field: six decimals is about a tenth of a metre. */
export const formatCoordinate = (value: number): string => String(Number(value.toFixed(6)));

const coordinatePairLabel = (latitude: number, longitude: number) =>
  `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`;

export const ADDRESS_LOOKUP_MESSAGES = {
  needAddress: 'Type the street, area and city above first, then try again.',
  noResult:
    'We could not find that address. Check the spelling, add the area and city, or use your current location instead.',
  offline: 'No internet connection. Check your connection and try again, or type the latitude and longitude yourself.',
  timeout: 'The address search took too long. Try again in a moment, or use your current location instead.',
  unavailable:
    'The address search is not available right now. Try again later, use your current location, or type the latitude and longitude yourself.',
} as const;

export const DEVICE_POSITION_MESSAGES: Record<DevicePositionFailure, string> = {
  'permission-denied':
    'Location access is blocked. Allow it in your device or browser settings, or use Find from address instead.',
  timeout: 'Finding your position took too long. Move somewhere with a clearer signal and try again.',
  unavailable: 'We could not read your position right now. Try again, or use Find from address instead.',
  unsupported: 'This device or browser cannot share its position. Use Find from address instead.',
};

export const lookupFailureMessage = (kind: Exclude<AddressLookupOutcome['kind'], 'found'>): string => {
  switch (kind) {
    case 'no-result':
      return ADDRESS_LOOKUP_MESSAGES.noResult;
    case 'offline':
      return ADDRESS_LOOKUP_MESSAGES.offline;
    case 'timeout':
      return ADDRESS_LOOKUP_MESSAGES.timeout;
    default:
      return ADDRESS_LOOKUP_MESSAGES.unavailable;
  }
};

export type ConfirmCopy = {
  title: string;
  paragraphs: string[];
  confirmLabel: string;
  cancelLabel: string;
};

/**
 * The approximate-pin caveat is stated every time, not only when the match looks
 * coarse: there is no reliable way to tell from the response how far off it is.
 */
export const APPROXIMATE_PIN_WARNING =
  'This pin may be approximate. Addresses in Nigeria often match only the area, so it can be a few kilometres off. ' +
  'For an exact pin, stand at the restaurant and choose Use my current location, or adjust the latitude and longitude yourself.';

export const addressMatchConfirmCopy = (match: AddressMatch): ConfirmCopy => ({
  title: 'Is this your restaurant?',
  paragraphs: [
    `Best match: ${match.placeName}`,
    `Pin: ${coordinatePairLabel(match.latitude, match.longitude)}`,
    APPROXIMATE_PIN_WARNING,
  ],
  confirmLabel: 'Use this pin',
  cancelLabel: 'Not this place',
});

/** Shown BEFORE the operating system's own permission prompt. */
export const locationDisclosureCopy: ConfirmCopy = {
  title: 'Use your current location?',
  paragraphs: [
    "FEASTY Partner will read your device's location once, only while this screen is open, to set your restaurant's map pin. It does not track you in the background.",
    'The pin you save is your restaurant’s location, which customers use to find you. Only do this while you are at the restaurant.',
    'Your phone or browser will ask for permission next.',
  ],
  confirmLabel: 'Continue',
  cancelLabel: 'Not now',
};

export const devicePositionConfirmCopy = (position: DevicePosition): ConfirmCopy => {
  const accuracy =
    position.accuracyMeters !== null && Number.isFinite(position.accuracyMeters)
      ? ` (accurate to about ${Math.max(1, Math.round(position.accuracyMeters))} m)`
      : '';

  return {
    title: 'Use this position?',
    paragraphs: [
      `Your device places you at ${coordinatePairLabel(position.latitude, position.longitude)}${accuracy}.`,
      'Only use it if you are at the restaurant right now. Otherwise the pin will point to where you are standing.',
    ],
    confirmLabel: 'Use this position',
    cancelLabel: 'Cancel',
  };
};
