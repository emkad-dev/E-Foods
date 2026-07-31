/**
 * Platform-free half of the delivery-location flow: error mapping, the browser
 * accuracy fallback, and OpenStreetMap address formatting. Kept free of
 * `react-native` / `expo-location` imports so it can be unit tested with
 * `node --test`.
 */

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type LocationErrorReason = 'permission-denied' | 'timeout' | 'unavailable' | 'unsupported';

export type CoordinatesResult =
  | { ok: true; coordinates: Coordinates }
  | { ok: false; reason: LocationErrorReason; message: string };

export type ResolvedAddress = {
  address: string;
  shortAddress: string;
};

export type BrowserPositionOptions = {
  enableHighAccuracy: boolean;
  maximumAge: number;
  timeout: number;
};

export const LOCATION_ERROR_MESSAGES: Record<LocationErrorReason, string> = {
  'permission-denied': 'Location access is blocked. Allow it for this site, or type your address below.',
  timeout: 'Finding you took too long. Try again, or type your address below.',
  unavailable: 'We could not read your location right now. Type your address below.',
  unsupported: 'This browser cannot share your location. Type your address below.',
};

export const HIGH_ACCURACY_OPTIONS: BrowserPositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 60000,
  timeout: 12000,
};

export const LOW_ACCURACY_OPTIONS: BrowserPositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 300000,
  timeout: 10000,
};

export type NominatimAddress = {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  country?: string;
};

export type NominatimReverseResponse = {
  address?: NominatimAddress;
  display_name?: string;
};

export const joinAddressParts = (parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');

export const locationFailure = (reason: LocationErrorReason): CoordinatesResult => ({
  ok: false,
  reason,
  message: LOCATION_ERROR_MESSAGES[reason],
});

/**
 * Browser `GeolocationPositionError` codes: 1 = denied, 2 = unavailable, 3 = timeout.
 */
export const browserPositionErrorReason = (code: number | null | undefined): LocationErrorReason => {
  if (code === 1) {
    return 'permission-denied';
  }

  if (code === 3) {
    return 'timeout';
  }

  return 'unavailable';
};

/**
 * Desktop browsers regularly stall or fail on high-accuracy fixes, so retry once with a
 * coarse fix rather than leaving the caller with no location at all.
 */
export const acquireBrowserCoordinates = async (
  requestPosition: (options: BrowserPositionOptions) => Promise<CoordinatesResult>
): Promise<CoordinatesResult> => {
  const preciseResult = await requestPosition(HIGH_ACCURACY_OPTIONS);

  if (preciseResult.ok) {
    return preciseResult;
  }

  if (preciseResult.reason === 'permission-denied' || preciseResult.reason === 'unsupported') {
    return preciseResult;
  }

  return requestPosition(LOW_ACCURACY_OPTIONS);
};

export const buildNominatimAddress = (payload: NominatimReverseResponse | null): ResolvedAddress | null => {
  if (!payload) {
    return null;
  }

  const address = payload.address ?? {};
  const displayName = payload.display_name?.trim() ?? '';
  const street = address.road ?? address.pedestrian ?? address.footway ?? address.path;
  const area = address.neighbourhood ?? address.suburb ?? address.city ?? address.town ?? address.village;

  const shortAddress = joinAddressParts([street, area]);
  const fullAddress = joinAddressParts([
    address.house_number && street ? `${address.house_number} ${street}` : street,
    address.suburb,
    address.city ?? address.town ?? address.village,
    address.county,
    address.state,
    address.country,
  ]);

  const resolvedShort = shortAddress || displayName.split(',').slice(0, 2).join(',').trim();
  const resolvedFull = fullAddress || displayName;

  if (!resolvedFull && !resolvedShort) {
    return null;
  }

  return {
    address: resolvedFull || resolvedShort,
    shortAddress: resolvedShort || resolvedFull,
  };
};

export const coordinatesLabel = (latitude: number, longitude: number) =>
  `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
