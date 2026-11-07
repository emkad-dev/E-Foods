/**
 * The pure half of the two ways a partner can set the store's map pin: find it
 * from the typed address (OpenStreetMap Nominatim) or read it from the device.
 * The wording of every confirmation and every failure, plus (re-exported from
 * packages/runtime/src/nominatimSearch.ts, shared with the customer app) the
 * request building and response parsing. No React Native, no `fetch`, no
 * `expo-location`, so all of it is testable with `node --test`; the I/O lives
 * in services/deviceLocation.ts.
 *
 * WHY EVERYTHING IS CONFIRMED BEFORE IT FILLS A FIELD. Nominatim often resolves
 * a Nigerian address only to the area (a ward, a suburb) and puts the pin
 * kilometres from the door. A pin that was silently dropped into the fields
 * would look just as authoritative as a surveyed one, and customers are matched
 * to restaurants by distance from it. So the matched place name is shown first,
 * with the caveat, and nothing is written until the partner agrees.
 */
import type { AddressLookupOutcome, AddressMatch } from '../../../../packages/runtime/src/nominatimSearch.ts';

// The search itself (request shape, parsing, outcome mapping, the rate-limited
// fetch) is shared with the customer app's map-search fallback; this module
// keeps only what is the partner's own: the wording and the device position.
export {
  ADDRESS_LOOKUP_MIN_INTERVAL_MS,
  ADDRESS_LOOKUP_TIMEOUT_MS,
  NOMINATIM_SEARCH_URL,
  buildAddressSearchUrl,
  normalizeAddressQuery,
  outcomeFromLookupError,
  outcomeFromResponse,
  parseGeocodeResults,
} from '../../../../packages/runtime/src/nominatimSearch.ts';
export type { AddressLookupOutcome, AddressMatch } from '../../../../packages/runtime/src/nominatimSearch.ts';

export type DevicePosition = {
  latitude: number;
  longitude: number;
  /** Metres, when the device reports it. */
  accuracyMeters: number | null;
};

export type DevicePositionFailure = 'permission-denied' | 'services-off' | 'timeout' | 'unavailable' | 'unsupported';

export type DevicePositionOutcome =
  | { kind: 'found'; position: DevicePosition }
  | { kind: DevicePositionFailure };

/**
 * Nominatim's usage policy requires the application to identify itself with a
 * User-Agent (or Referer) that is not a library default. Native sends this;
 * browsers refuse to let a page set User-Agent and send the page's own origin as
 * Referer instead, which identifies the app just as well.
 */
export const NOMINATIM_USER_AGENT = 'FEASTY-Partner/1.0 (https://feasty.com.ng)';

/**
 * OpenStreetMap's data licence asks for visible credit, and the partner should
 * know a third party receives the address they typed. Shown beside the button and
 * again in the confirmation.
 */
export const OSM_ATTRIBUTION = 'Address search by OpenStreetMap. © OpenStreetMap contributors';
export const ADDRESS_SENT_NOTICE =
  'What you type in the address search is sent to our map search service, and to OpenStreetMap if you press Search the map.';

/**
 * Bound on a whole browser position request. The browser's own timeout only
 * starts once the user has answered the permission prompt, so an ignored prompt
 * would otherwise leave the button spinning for ever.
 */
export const WEB_POSITION_TOTAL_TIMEOUT_MS = 40000;

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
  'services-off': 'Location is turned off on this device. Turn it on in your settings, then try again.',
  'permission-denied':
    'Location access is blocked. Allow it in your device or browser settings, or search for your address instead.',
  timeout: 'Finding your position took too long. Move somewhere with a clearer signal and try again.',
  unavailable: 'We could not read your position right now. Try again, or search for your address instead.',
  unsupported: 'This device or browser cannot share its position. Search for your address instead.',
};

/**
 * How close a fix has to be before it may set the restaurant's pin. Customers
 * are matched to restaurants by distance from it, and a laptop's Wi-Fi fix is
 * typically hundreds of metres to kilometres out, so a coarse reading is
 * refused rather than saved as if it were surveyed.
 */
export const MAX_PIN_ACCURACY_METERS = 150;

export type PinPositionDecision =
  | { kind: 'use'; position: DevicePosition }
  | { kind: 'retry'; reason: 'too-coarse' | 'no-accuracy'; message: string };

export const PIN_ACCURACY_MESSAGES = {
  tooCoarse:
    'Your location is not accurate enough yet. Move near a window or outside, wait a few seconds, and try again.',
  noAccuracy:
    'Your device did not say how accurate its location is, so we cannot trust it. Move near a window or outside and try again.',
} as const;

/**
 * Decides whether a device fix may be offered as the restaurant's pin. Never
 * fills anything itself: a fix that is worse than the limit, or that reports no
 * accuracy at all, is turned into a "move and try again" message. The limit is
 * inclusive, and NaN or a negative accuracy counts as not reported.
 */
export const decidePinPosition = (position: DevicePosition): PinPositionDecision => {
  const accuracy = position.accuracyMeters;

  if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0) {
    return { kind: 'retry', reason: 'no-accuracy', message: PIN_ACCURACY_MESSAGES.noAccuracy };
  }

  if (accuracy > MAX_PIN_ACCURACY_METERS) {
    return { kind: 'retry', reason: 'too-coarse', message: PIN_ACCURACY_MESSAGES.tooCoarse };
  }

  return { kind: 'use', position };
};

export type MapSearchOutcome =
  | { kind: 'results'; results: { label: string; latitude: number; longitude: number }[] }
  | { kind: 'failed' };

/**
 * Shapes the one-shot Nominatim answer for the shared search field's "Search the
 * map" button. `no-result` is an answer (nothing there); every other failure is
 * the service not answering, which is what makes the field say so.
 */
export const mapSearchFromOutcome = (outcome: AddressLookupOutcome): MapSearchOutcome => {
  if (outcome.kind === 'found') {
    return {
      kind: 'results',
      results: outcome.matches.map((match) => ({
        label: match.placeName,
        latitude: match.latitude,
        longitude: match.longitude,
      })),
    };
  }

  return outcome.kind === 'no-result' ? { kind: 'results', results: [] } : { kind: 'failed' };
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
    OSM_ATTRIBUTION,
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
