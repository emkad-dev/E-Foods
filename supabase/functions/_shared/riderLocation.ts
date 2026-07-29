// Live rider position lives in the UNLOGGED `rider_live_location` table.
// UNLOGGED means these writes skip WAL entirely, which is the whole point: a
// rider ping is rewritten every few seconds and is worthless once superseded,
// so paying WAL + vacuum cost for it on the durable DispatchRiderRecord table
// is waste. The table is truncated on crash recovery, which is fine — it
// repopulates from the next ping within seconds.
//
// A fix older than RIDER_LIVE_TTL_MS is treated as absent. That is what makes a
// rider who closed the app drop off the fleet map without any sweep job: the
// staleness filter is part of every read rather than a scheduled cleanup.
export const RIDER_LIVE_TTL_MS = 90_000;

// DispatchRiderRecord keeps a durable copy of the last known position, refreshed
// at most this often per rider. The throttle is enforced in SQL by a WHERE on
// updatedAt, so deciding not to write costs no extra round trip.
export const DURABLE_SYNC_INTERVAL_SECONDS = 60;

// Mirrors the database columns, so this stays snake_case while the domain
// DispatchRiderRow stays camelCase.
export type RiderLiveLocationRow = {
  rider_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
};

export const buildRiderLocationUpsert = (
  riderId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  nowIso: string
): RiderLiveLocationRow => ({
  rider_id: riderId,
  latitude,
  longitude,
  accuracy,
  updated_at: nowIso,
});

// A future-dated stamp reads as live on purpose — clock skew between the edge
// runtime and Postgres should never blank the fleet map.
export const isRiderLocationLive = (
  updatedAt: string | null | undefined,
  nowMs: number,
  ttlMs: number = RIDER_LIVE_TTL_MS
): boolean => {
  if (!updatedAt) {
    return false;
  }
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return nowMs - parsed < ttlMs;
};

// Overlays a live fix onto the durable rider row. Returns the input unchanged
// when there is no live row or it has aged out, so every caller degrades to the
// DispatchRiderRecord columns — at most DURABLE_SYNC_INTERVAL_SECONDS stale.
export const mergeRiderLiveLocation = <
  T extends {
    id: string;
    latitude?: number | null;
    longitude?: number | null;
    updatedAt?: string | null;
  }
>(
  rider: T,
  live: RiderLiveLocationRow | undefined,
  nowMs: number
): T => {
  if (!live || !isRiderLocationLive(live.updated_at, nowMs)) {
    return rider;
  }
  return {
    ...rider,
    latitude: live.latitude,
    longitude: live.longitude,
    updatedAt: live.updated_at,
  };
};
