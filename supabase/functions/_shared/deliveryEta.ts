// Straight-line (haversine) delivery ETA maths. Pure and DB-free so it can be
// unit-tested directly; the average speed it divides by comes from
// dispatchTracking.ts via loadDispatchTrackingConfig (never-throwing,
// bounds-checked). Deliberately mirrored by the client's own copy in
// packages/domain/src/tracking.ts - the two runtimes (Deno edge vs the RN
// client) cannot share a module, the same way realtime.ts's topic names are
// mirrored between supabase/functions and packages/auth. The server computes
// the ETA once for the initial order snapshot; the client recomputes it live
// from each rider-position broadcast. Both must agree, so both floor at 1
// minute and pad by the same +/-3.

export const EARTH_RADIUS_KM = 6371;

/** Minimum ETA shown - a rider "0 minutes away" reads as broken, not fast. */
export const MIN_ETA_MINUTES = 1;

/** Half-width of the shown ETA range: `eta +/- ETA_RANGE_PADDING_MINUTES`. */
export const ETA_RANGE_PADDING_MINUTES = 3;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance between two lat/lng points, in kilometres. */
export const haversineKm = (
  aLatitude: number,
  aLongitude: number,
  bLatitude: number,
  bLongitude: number
): number => {
  const dLat = toRadians(bLatitude - aLatitude);
  const dLng = toRadians(bLongitude - aLongitude);
  const lat1 = toRadians(aLatitude);
  const lat2 = toRadians(bLatitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Minutes to cover `distanceKm` at `speedKmh`, rounded to the nearest minute
 * and floored at MIN_ETA_MINUTES. A non-positive or non-finite speed can never
 * reach here from loadDispatchTrackingConfig (it is bounds-checked to the
 * default first), but this guards it anyway so a direct caller cannot produce
 * Infinity/NaN.
 */
export const computeEtaMinutes = (distanceKm: number, speedKmh: number): number => {
  if (!Number.isFinite(distanceKm) || distanceKm < 0 || !Number.isFinite(speedKmh) || speedKmh <= 0) {
    return MIN_ETA_MINUTES;
  }

  const minutes = Math.round((distanceKm / speedKmh) * 60);
  return Math.max(MIN_ETA_MINUTES, minutes);
};

export type EtaRange = {
  minMinutes: number;
  maxMinutes: number;
  minutes: number;
};

/** The midpoint ETA plus a +/-ETA_RANGE_PADDING_MINUTES band, floored at 1. */
export const computeEtaRange = (distanceKm: number, speedKmh: number): EtaRange => {
  const minutes = computeEtaMinutes(distanceKm, speedKmh);
  return {
    minMinutes: Math.max(MIN_ETA_MINUTES, minutes - ETA_RANGE_PADDING_MINUTES),
    maxMinutes: minutes + ETA_RANGE_PADDING_MINUTES,
    minutes,
  };
};
