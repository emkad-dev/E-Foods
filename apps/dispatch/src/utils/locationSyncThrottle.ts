/**
 * Decides whether a rider location fix is worth an edge-function invocation.
 *
 * Every syncDispatchRiderLocation call is one invocation against the Supabase
 * Free plan's 500K/month quota. At the old 5s / 5m active-delivery cadence a
 * single delivery cost ~300 invocations (~4.5M/month at 500 orders/day), so
 * rider GPS alone would have blown the quota. The active cadence is now a 15s /
 * 25m watch plus this client-side gate.
 *
 * Kept free of React and expo imports so node:test can exercise it directly.
 */

export const ACTIVE_MIN_SYNC_DISTANCE_M = 25;
export const ACTIVE_MIN_SYNC_INTERVAL_MS = 15_000;
/** While a delivery is active, a position is re-sent at least this often. */
export const ACTIVE_FORCED_SYNC_MS = 60_000;
/**
 * A forced or transition sync may re-send the last fix even though the OS
 * stopped reporting (a 25m distanceInterval means a parked rider gets no new
 * fixes, which itself proves they moved < 25m). Past this age the fix is no
 * longer evidence of anything - GPS may simply be lost - so it is not re-sent.
 */
export const MAX_RESEND_FIX_AGE_MS = 5 * 60_000;

export type SyncPoint = { latitude: number; longitude: number; at: number };

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export const distanceMetres = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) => {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * For a NEW fix during an active delivery: skip only when the rider has both
 * barely moved AND synced very recently. Idle presence heartbeats are already
 * spaced by their 60s watch interval and always pass.
 */
export const shouldSyncFix = (input: {
  activeDelivery: boolean;
  fix: { latitude: number; longitude: number };
  lastSync: SyncPoint | null;
  now: number;
}) => {
  if (!input.activeDelivery || !input.lastSync) {
    return true;
  }

  const movedEnough = distanceMetres(input.lastSync, input.fix) >= ACTIVE_MIN_SYNC_DISTANCE_M;
  const waitedEnough = input.now - input.lastSync.at >= ACTIVE_MIN_SYNC_INTERVAL_MS;
  return movedEnough || waitedEnough;
};

/** The 60s keep-alive during an active delivery. */
export const isForcedSyncDue = (input: { lastSync: SyncPoint | null; now: number }) =>
  !input.lastSync || input.now - input.lastSync.at >= ACTIVE_FORCED_SYNC_MS;

/** Whether the last fix is still recent enough to re-send on a forced/transition sync. */
export const canResendFix = (input: { fixTimestamp: number; now: number }) =>
  input.now - input.fixTimestamp <= MAX_RESEND_FIX_AGE_MS;
