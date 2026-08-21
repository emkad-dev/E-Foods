// Client-side live-tracking helpers: which order states show the map, and the
// straight-line ETA maths the customer screen recomputes on every
// rider-position broadcast. Deliberately mirrors the server's
// supabase/functions/_shared/deliveryEta.ts + dispatchTracking.ts - the RN
// client and the Deno edge cannot share a module, so both carry the same
// floor-at-1, pad-by-3 logic and must agree. The server computes the initial
// ETA for the order snapshot; this recomputes it live from each new position.

import type { OrderStatus } from './orders';

/**
 * Order states in which a rider is en route and the customer sees the map.
 * Both are canonical status values with no legacy aliases (see
 * LEGACY_ORDER_STATUS_MAP in ./orders), so a direct membership check needs no
 * normalization - which also keeps this module free of a runtime import from
 * ./orders, so it strip-types-tests under `node --test` without an extension.
 */
export const LIVE_MAP_ORDER_STATUSES: OrderStatus[] = ['picked_up', 'on_the_way'];

/** The default average rider speed (km/h) if the server sent none. */
export const DEFAULT_AVERAGE_SPEED_KMH = 18;
export const MAX_AVERAGE_SPEED_KMH = 200;

export const MIN_ETA_MINUTES = 1;
export const ETA_RANGE_PADDING_MINUTES = 3;

const EARTH_RADIUS_KM = 6371;

/** The map only renders once a rider is actually moving toward the customer. */
export const shouldShowLiveMap = (status: string | null | undefined): boolean =>
  !!status && (LIVE_MAP_ORDER_STATUSES as string[]).includes(status);

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

/** Clamps an untrusted average speed to a sane default, mirroring the server. */
export const resolveAverageSpeedKmh = (value: number | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_AVERAGE_SPEED_KMH) {
    return value;
  }
  return DEFAULT_AVERAGE_SPEED_KMH;
};

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

export const computeEtaRange = (distanceKm: number, speedKmh: number): EtaRange => {
  const minutes = computeEtaMinutes(distanceKm, speedKmh);
  return {
    minMinutes: Math.max(MIN_ETA_MINUTES, minutes - ETA_RANGE_PADDING_MINUTES),
    maxMinutes: minutes + ETA_RANGE_PADDING_MINUTES,
    minutes,
  };
};

/**
 * ETA range straight from two coordinate pairs and an (untrusted) speed.
 * Returns null when either point is not a finite coordinate pair.
 */
export const computeEtaRangeBetween = (
  rider: { latitude?: number | null; longitude?: number | null } | null | undefined,
  destination: { latitude?: number | null; longitude?: number | null } | null | undefined,
  speedKmh: number | null | undefined
): EtaRange | null => {
  if (
    !rider ||
    !destination ||
    typeof rider.latitude !== 'number' ||
    !Number.isFinite(rider.latitude) ||
    typeof rider.longitude !== 'number' ||
    !Number.isFinite(rider.longitude) ||
    typeof destination.latitude !== 'number' ||
    !Number.isFinite(destination.latitude) ||
    typeof destination.longitude !== 'number' ||
    !Number.isFinite(destination.longitude)
  ) {
    return null;
  }

  const distanceKm = haversineKm(rider.latitude, rider.longitude, destination.latitude, destination.longitude);
  return computeEtaRange(distanceKm, resolveAverageSpeedKmh(speedKmh));
};

/** "12 – 18 min", or "5 min" when the band collapses to a single value. */
export const formatEtaRange = (range: EtaRange | null | undefined): string => {
  if (!range) {
    return 'Calculating ETA';
  }
  if (range.minMinutes === range.maxMinutes) {
    return `${range.minMinutes} min`;
  }
  return `${range.minMinutes} – ${range.maxMinutes} min`;
};
