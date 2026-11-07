/**
 * The I/O half of setting the store's map pin: the device position and the
 * Nominatim forward geocode. Parsing, wording and request shape live in
 * domain/addressLookup.ts, which is the part with tests.
 *
 * WEB IS A SEPARATE PATH ON PURPOSE. expo-location's web module cannot be relied
 * on (it cannot reverse geocode, and routes watch events through its own id
 * counter), so on web the browser's own `navigator.geolocation` is used, as
 * apps/customer does. Native uses expo-location, foreground permission only: this
 * app never asks for background location and the manifest blocks it.
 *
 * Both entry points are meant to be called ONLY from a button press. The address
 * lookup in particular must never run as the partner types: Nominatim's usage
 * policy forbids autocomplete-style traffic.
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { isUsableCoordinatePair } from '../../../../packages/domain/src/restaurantLocation.ts';
import { reportError } from '../../../../packages/observability/src/sentry';
import { findAddressMatches } from '../../../../packages/runtime/src/nominatimSearch.ts';
import {
  NOMINATIM_USER_AGENT,
  WEB_POSITION_TOTAL_TIMEOUT_MS,
  type AddressLookupOutcome,
  type DevicePositionFailure,
  type DevicePositionOutcome,
} from '../domain/addressLookup';

const NATIVE_POSITION_TIMEOUT_MS = 15000;
const BROWSER_HIGH_ACCURACY = { enableHighAccuracy: true, maximumAge: 60000, timeout: 12000 };
const BROWSER_LOW_ACCURACY = { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 };

const fail = (kind: DevicePositionFailure): DevicePositionOutcome => ({ kind });

const found = (
  latitude: number,
  longitude: number,
  accuracyMeters: number | null | undefined
): DevicePositionOutcome =>
  // 0,0 is what some emulators and broken fixes report; it is not a position.
  isUsableCoordinatePair(latitude, longitude)
    ? {
        kind: 'found',
        position: {
          latitude,
          longitude,
          accuracyMeters: typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters) ? accuracyMeters : null,
        },
      }
    : fail('unavailable');

const browserGeolocation = () =>
  typeof navigator === 'undefined' || !navigator.geolocation ? null : navigator.geolocation;

const requestBrowserPosition = (options: PositionOptions) =>
  new Promise<DevicePositionOutcome>((resolve) => {
    const geolocation = browserGeolocation();

    if (!geolocation) {
      resolve(fail('unsupported'));
      return;
    }

    geolocation.getCurrentPosition(
      (position) => resolve(found(position.coords.latitude, position.coords.longitude, position.coords.accuracy)),
      // GeolocationPositionError codes: 1 denied, 3 timeout, anything else unavailable.
      (positionError) =>
        resolve(
          fail(
            positionError?.code === 1 ? 'permission-denied' : positionError?.code === 3 ? 'timeout' : 'unavailable'
          )
        ),
      options
    );
  });

/**
 * Desktop browsers regularly stall or fail on a high-accuracy fix, so one retry
 * with a coarse fix is better than giving up. A denial or missing API is final.
 */
const getBrowserPositionUnbounded = async (): Promise<DevicePositionOutcome> => {
  const precise = await requestBrowserPosition(BROWSER_HIGH_ACCURACY);

  if (precise.kind === 'found' || precise.kind === 'permission-denied' || precise.kind === 'unsupported') {
    return precise;
  }

  return requestBrowserPosition(BROWSER_LOW_ACCURACY);
};

/**
 * The browser's own timeouts only start once the permission prompt has been
 * answered, so a prompt the user ignores would leave the button busy for ever.
 * The whole call is raced against one overall bound.
 */
const getBrowserPosition = async (): Promise<DevicePositionOutcome> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bound = new Promise<DevicePositionOutcome>((resolve) => {
    timer = setTimeout(() => resolve(fail('timeout')), WEB_POSITION_TOTAL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([getBrowserPositionUnbounded(), bound]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const getNativePosition = async (): Promise<DevicePositionOutcome> => {
  try {
    // Asked first: with the device's location switched off the permission prompt
    // can succeed and the fix then fail, which reads as a mystery. This is an
    // expected refusal, not an error, so it is not reported.
    if (!(await Location.hasServicesEnabledAsync())) {
      return fail('services-off');
    }

    // Foreground only. The disclosure the screen shows has already been agreed
    // to by the time this runs.
    const permission = await Location.requestForegroundPermissionsAsync();

    if (!permission.granted) {
      return fail('permission-denied');
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), NATIVE_POSITION_TIMEOUT_MS);
    });

    try {
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: true }),
        timedOut,
      ]);

      if (position === 'timed-out') {
        return fail('timeout');
      }

      return found(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    reportError('partner.getDevicePosition', error);
    return fail('unavailable');
  }
};

/** One position fix. Call only after the in-app disclosure has been accepted. */
export const getDevicePosition = (): Promise<DevicePositionOutcome> =>
  Platform.OS === 'web' ? getBrowserPosition() : getNativePosition();

/**
 * Forward-geocodes a typed address with OpenStreetMap Nominatim, one request
 * per press, through the implementation shared with the customer app. Never
 * throws: every way it can go wrong is an outcome the screen words for the
 * partner.
 */
export const findAddressMatch = (address: string): Promise<AddressLookupOutcome> =>
  findAddressMatches(address, {
    // Browsers refuse to let a page set User-Agent and send the page's own
    // origin as Referer, which identifies the app to Nominatim instead.
    userAgent: Platform.OS === 'web' ? undefined : NOMINATIM_USER_AGENT,
    onUnexpectedError: (error) => reportError('partner.findAddressMatch', error),
  });
