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

// One row from ebuy_nearest_riders, already ordered nearest-first by the geo
// query. Mirrors the SQL return type, hence snake_case.
export type RankedRiderRow = {
  rider_id: string;
  latitude: number;
  longitude: number;
  metres: number;
};

// Joins distance-ranked geo rows to their durable profile rows.
//
// Two things this exists to guarantee, both easy to break by inlining:
//   1. The geo query's ordering is preserved. A lookup keyed by id (the `in`
//      filter that fetches the profiles) returns rows in arbitrary order, so the
//      ranked list — not the map — drives iteration.
//   2. A ranked rider with no profile row is dropped, not emitted as a partial
//      record. That happens when a profile is deleted while a live location row
//      survives, or when a dispatch account pings before its application is
//      approved.
export const joinRankedRiders = <
  T extends { id: string; latitude?: number | null; longitude?: number | null }
>(
  ranked: RankedRiderRow[],
  ridersById: Map<string, T>
): Array<{ rider: T; metres: number }> =>
  ranked.flatMap((row) => {
    const rider = ridersById.get(row.rider_id);
    if (!rider) {
      return [];
    }
    return [
      {
        rider: { ...rider, latitude: row.latitude, longitude: row.longitude },
        metres: Math.round(row.metres),
      },
    ];
  });

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
