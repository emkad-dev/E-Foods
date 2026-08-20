// Rider position HISTORY (Task 11 / D3) - a thin, DB-touching layer over the
// two SQL functions in 20260820_dispatch_rider_ping.sql, the same shape as
// dispatchOffers.ts over the delivery-offer functions.
//
// This module holds no policy of its own about WHEN a ping is throttled or
// WHICH rows are retained - that is entirely in SQL, under a per-rider
// advisory lock for the throttle and `for update skip locked` for retention.
// See the migration for why: a TypeScript-side read-then-write throttle is
// racy under two overlapping calls for the same rider, and this plan has hit
// exactly that bug shape before (dispatchLoadRelease.test.ts's header).
//
// Deliberately separate from dispatchRiders.ts, which owns
// DispatchRiderRecord.latitude/longitude - the CURRENT position, overwritten
// on every syncDispatchRiderLocation call regardless of throttling. This
// module only appends to the historical track.

import { serviceClient } from './client.ts';
import { logEdgeEvent } from './observability.ts';
import { sanitizeText } from './rpc/coercion.ts';

/** At most one ping row per rider inside this many seconds. Enforced in SQL. */
export const DISPATCH_RIDER_PING_THROTTLE_SECONDS = 10;

/** Pings older than this are eligible for deletion by the retention sweep. */
export const DISPATCH_RIDER_PING_RETENTION_HOURS = 24;

/** How many stale pings one retention sweep deletes per call. */
export const DISPATCH_RIDER_PING_RETENTION_LIMIT = 500;

export type RecordDispatchRiderPingResult = {
  pingId: string | null;
  recorded: boolean;
};

const firstRow = <T>(data: unknown): T | null => {
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as T | null;
};

/**
 * Appends a position-history row for `riderId`, or reports that the call
 * landed inside the throttle window and nothing was written.
 *
 * Never throws for the throttle case - `recorded: false` is the expected,
 * normal outcome of a device polling every few seconds, not an error. It
 * DOES throw on a genuine database error (a real Postgrest/RPC failure), the
 * same convention every other function in this module family uses.
 */
export const recordDispatchRiderPing = async (
  riderId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null
): Promise<RecordDispatchRiderPingResult> => {
  const { data, error } = await serviceClient.rpc('ebuy_record_dispatch_rider_ping', {
    p_accuracy: accuracy,
    p_latitude: latitude,
    p_longitude: longitude,
    p_rider_id: riderId,
    p_throttle_seconds: DISPATCH_RIDER_PING_THROTTLE_SECONDS,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = firstRow<{ pingId?: string | null; recorded?: boolean }>(data);

  return {
    pingId: sanitizeText(row?.pingId) || null,
    recorded: row?.recorded === true,
  };
};

export type DispatchRiderPingRetentionResult = {
  deleted: number;
};

/**
 * Deletes pings older than DISPATCH_RIDER_PING_RETENTION_HOURS, bounded to
 * DISPATCH_RIDER_PING_RETENTION_LIMIT rows per call. Run by queue-drainer on
 * its existing every-minute pg_cron schedule, the same way the delivery-offer
 * sweep (Task 10 / D2) rides that cron - see queue-drainer/index.ts for why
 * it must be sequenced BEFORE runWithBackpressure, not after.
 *
 * Never throws to the caller: a bad retention sweep must not fail the queue
 * drain it rides alongside, mirroring sweepDispatchOffers's own contract.
 */
export const sweepExpiredDispatchRiderPings = async (): Promise<DispatchRiderPingRetentionResult> => {
  try {
    const { data, error } = await serviceClient.rpc('ebuy_delete_expired_dispatch_rider_pings', {
      p_limit: DISPATCH_RIDER_PING_RETENTION_LIMIT,
      p_retention_hours: DISPATCH_RIDER_PING_RETENTION_HOURS,
    });

    if (error) {
      throw new Error(error.message);
    }

    return {
      deleted: typeof data === 'number' ? data : 0,
    };
  } catch (error) {
    logEdgeEvent('error', 'dispatch rider ping retention sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { deleted: 0 };
  }
};
