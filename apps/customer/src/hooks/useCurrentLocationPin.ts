import { useCallback, useRef, useState } from 'react';
import { getCurrentCoordinates, reverseGeocode } from '../services/deviceLocation';
import { assessFixAccuracy } from '../services/locationResolution';

export type CurrentLocationPin = {
  latitude: number;
  longitude: number;
  /** The reverse-geocoded name, or null when the lookup found nothing. */
  label: string | null;
  shortAddress: string | null;
};

export type CurrentLocationResult = { ok: true; pin: CurrentLocationPin } | { ok: false; message: string };

/**
 * "Use my current location", shared by the launch prompt and the
 * delivery-address screen: one fix, refused when it is too coarse to deliver
 * to, then reverse geocoded ONCE. The screen used to keep a live watch running
 * and re-geocode every 15 s; a delivery spot is chosen, not tracked.
 */
export function useCurrentLocationPin() {
  const [locating, setLocating] = useState(false);
  const busyRef = useRef(false);

  const locate = useCallback(async (): Promise<CurrentLocationResult | null> => {
    // A double tap must not ask twice; the second press simply does nothing.
    if (busyRef.current) {
      return null;
    }
    busyRef.current = true;
    setLocating(true);

    try {
      const result = await getCurrentCoordinates();
      if (!result.ok) {
        return { ok: false, message: result.message };
      }

      const accuracy = assessFixAccuracy(result.coordinates.accuracyMeters);
      if (!accuracy.ok) {
        return { ok: false, message: accuracy.message };
      }

      const { latitude, longitude } = result.coordinates;
      // A failed reverse geocode must not lose the fix: the coordinates are
      // what coverage and the rider need; the name is for display.
      const resolved = await reverseGeocode(latitude, longitude).catch(() => null);

      return {
        ok: true,
        pin: {
          latitude,
          longitude,
          label: resolved?.address ?? null,
          shortAddress: resolved?.shortAddress ?? null,
        },
      };
    } catch {
      return { ok: false, message: 'We could not read your location. Try again, or search for your address below.' };
    } finally {
      busyRef.current = false;
      setLocating(false);
    }
  }, []);

  return { locate, locating };
}
