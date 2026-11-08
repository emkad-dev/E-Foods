/**
 * Platform-free half of the delivery-location flow: error mapping, the browser
 * accuracy fallback, and OpenStreetMap address formatting. Kept free of
 * `react-native` / `expo-location` imports so it can be unit tested with
 * `node --test`.
 */

export type Coordinates = {
  latitude: number;
  longitude: number;
  /** Radius in metres the device is confident about, when it reports one. */
  accuracyMeters?: number | null;
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

// Each one points at search, not at typing: typed text alone is not an address
// any more (it has no pin), so "type your address" would be a dead end.
export const LOCATION_ERROR_MESSAGES: Record<LocationErrorReason, string> = {
  'permission-denied': 'Location access is blocked. Allow it and try again, or search for your address below.',
  timeout: 'Finding you took too long. Try again, or search for your address below.',
  unavailable: 'We could not read your location right now. Try again, or search for your address below.',
  unsupported: 'This device cannot share your location. Search for your address below.',
};

/**
 * Worse than this and the fix is not a delivery spot. A laptop browser
 * locating by Wi-Fi or IP typically reports several kilometres, which would put
 * the pin in the wrong neighbourhood and the coverage check on the wrong side
 * of a boundary, so it is refused and the customer is asked to search instead.
 */
export const MAX_FIX_ACCURACY_METERS = 1000;

export type FixAccuracyVerdict = { ok: true } | { ok: false; message: string };

const describeDistance = (meters: number) =>
  meters >= 1000 ? `${Math.round(meters / 100) / 10} km` : `${Math.round(meters)} m`;

/**
 * Should this fix become the pin?
 *
 * An unreported accuracy is accepted: some Android devices omit it on a
 * perfectly good GPS fix, and refusing those would turn "Use my current
 * location" off for them with no way to fix it. A reported radius that is not a
 * finite non-negative number is treated the same as unreported.
 */
export const assessFixAccuracy = (
  accuracyMeters: number | null | undefined,
  maxMeters: number = MAX_FIX_ACCURACY_METERS
): FixAccuracyVerdict => {
  if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
    return { ok: true };
  }

  if (accuracyMeters <= maxMeters) {
    return { ok: true };
  }

  return {
    ok: false,
    message:
      `Your device only knows your location to within about ${describeDistance(accuracyMeters)}, ` +
      'which is too rough for a rider to find you. Search for your address below instead.',
  };
};

/** The radius from a platform fix, or null when it is missing or meaningless. */
export const toAccuracyMeters = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

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
