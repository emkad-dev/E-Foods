// Dispatch rider records: the rows that back both the rider's own profile and
// the courier a dispatcher assigns to an order.

import { serviceClient } from './client.ts';
import { DEFAULT_NIGERIA_COORDINATE } from './nigeriaGeography.ts';
import { broadcastRidersChanged } from './realtime.ts';
import { nowIso, parseNumber, sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';

export type DispatchRiderRow = {
  acceptanceRate?: number | null;
  activeLoad?: number | null;
  completedTrips?: number | null;
  createdAt?: string | null;
  currentAddress?: string | null;
  displayName: string;
  id: string;
  lga?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phoneNumber?: string | null;
  region?: string | null;
  status: string;
  updatedAt?: string | null;
  vehicleType: string;
  zone: string;
};

export const DEFAULT_DISPATCH_STATUS = 'Available';
export const DEFAULT_DISPATCH_VEHICLE = 'Bike';

export const DISPATCH_RIDER_COLUMNS =
  'id,displayName,status,zone,vehicleType,acceptanceRate,activeLoad,completedTrips,latitude,longitude,createdAt,updatedAt';

export const buildDispatchRiderResponse = (rider: DispatchRiderRow) => ({
  acceptanceRate: rider.acceptanceRate ?? null,
  activeLoad: rider.activeLoad ?? 0,
  completedTrips: rider.completedTrips ?? 0,
  currentAddress: sanitizeOptionalText(rider.currentAddress),
  displayName: sanitizeText(rider.displayName, 'Dispatch rider'),
  id: rider.id,
  lga: sanitizeOptionalText(rider.lga ?? rider.zone),
  latitude: rider.latitude ?? null,
  longitude: rider.longitude ?? null,
  phoneNumber: sanitizeOptionalText(rider.phoneNumber),
  region: sanitizeOptionalText(rider.region ?? rider.zone),
  status: sanitizeText(rider.status, DEFAULT_DISPATCH_STATUS),
  updatedAt: rider.updatedAt ?? null,
  vehicleType: sanitizeText(rider.vehicleType, DEFAULT_DISPATCH_VEHICLE),
  zone: sanitizeText(rider.zone),
});

export const loadDispatchRiderPhoneNumber = async (riderId: string | null | undefined) => {
  const safeRiderId = sanitizeText(riderId);
  if (!safeRiderId) {
    return null;
  }

  const { data, error } = await serviceClient
    .from('DispatchRiderRecord')
    .select('phoneNumber')
    .eq('id', safeRiderId)
    .maybeSingle<Pick<DispatchRiderRow, 'phoneNumber'>>();

  if (error) {
    throw new Error(error.message);
  }

  return sanitizeOptionalText(data?.phoneNumber);
};

/** Courier contact + last known position, as shown on the customer order screen. */
export const loadDispatchRiderSnapshot = async (riderId: string | null | undefined) => {
  const safeRiderId = sanitizeText(riderId);
  if (!safeRiderId) {
    return {
      courierLatitude: null,
      courierLongitude: null,
      courierUpdatedAt: null,
      courierPhone: null,
    };
  }

  const { data, error } = await serviceClient
    .from('DispatchRiderRecord')
    .select('phoneNumber,latitude,longitude,updatedAt')
    .eq('id', safeRiderId)
    .maybeSingle<Pick<DispatchRiderRow, 'latitude' | 'longitude' | 'phoneNumber' | 'updatedAt'>>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    courierLatitude: data?.latitude ?? null,
    courierLongitude: data?.longitude ?? null,
    courierPhone: sanitizeOptionalText(data?.phoneNumber),
    courierUpdatedAt: data?.updatedAt ?? null,
  };
};

/**
 * Moves a rider's live workload by a relative delta. Clamped at zero so a
 * double-decrement cannot go negative.
 *
 * This used to be a select-then-update (read the current activeLoad, then
 * write activeLoad + delta) - safe only as long as every write was
 * human-triggered, so a collision needed two humans acting on the same
 * rider in the same second. Automatic dispatch assignment
 * (_shared/dispatchSelection.ts) now writes to the same column on every
 * accept/preparing/ready transition, concurrently with manual dispatch
 * activity by construction, so a read-then-write here can lose an update:
 * two deltas that both read the same starting value each compute their own
 * "next" value independently, and the second write clobbers the first
 * instead of compounding with it. ebuy_adjust_dispatch_rider_load
 * (20260814_dispatch_load_lifecycle.sql) is a single atomic
 * `activeLoad = greatest(0, activeLoad + delta)` UPDATE, so two concurrent
 * deltas against the same rider always both land, in the order Postgres's
 * own row locking serializes them.
 */
export const adjustDispatchRiderLoad = async (riderId: string | null | undefined, delta: number) => {
  const safeRiderId = sanitizeText(riderId);
  if (!safeRiderId || !Number.isFinite(delta) || delta === 0) {
    return;
  }

  const { error } = await serviceClient.rpc('ebuy_adjust_dispatch_rider_load', {
    p_delta: Math.trunc(delta),
    p_id: safeRiderId,
  });

  if (error) {
    throw new Error(error.message);
  }
};

/**
 * Creates a rider record if there isn't one, and refreshes the profile
 * fields if there is.
 *
 * It deliberately does NOT carry `activeLoad`: this is an upsert
 * (`on conflict (id) do update`), and PostgREST only updates the columns
 * present in the payload, so writing the column here would reset a live
 * counter to 0 every time an existing dispatcher is re-provisioned
 * (assignUserRole, restoreUserRole, an admin approving a dispatch
 * application for an id that already has a record, or a rider
 * re-submitting their own onboarding). Every call site passed a literal
 * `activeLoad: 0`, so nothing ever used it to set a value - it only ever
 * clobbered one, dropping that rider's in-flight claims out of the ledger
 * and making the scorer (which weights activeLoad at 1.0) send them more
 * work. The column is `INTEGER NOT NULL DEFAULT 0`
 * (functions/prisma/migrations/20260426_ops_read_models), so omitting it
 * still gives a brand-new record exactly the 0 it used to be given
 * explicitly - and unlike reading the current value and writing it back,
 * omitting it cannot lose an update to a concurrent claim.
 *
 * acceptanceRate/completedTrips have the same overwrite shape and are left
 * as they are: they are display statistics with no code reading them for a
 * decision, so they are not part of the load ledger this guard protects.
 */
export const ensureDispatchRiderRecord = async (
  riderId: string,
  riderData: {
    acceptanceRate?: number | null;
    completedTrips?: number;
    currentAddress?: string | null;
    displayName: string;
    lga?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    phoneNumber?: string | null;
    region?: string | null;
    status?: string;
    vehicleType?: string;
    zone?: string;
  }
) => {
  const timestamp = nowIso();
  const { error } = await serviceClient.from('DispatchRiderRecord').upsert(
    {
      id: riderId,
      displayName: sanitizeText(riderData.displayName, 'Dispatch rider'),
      status: sanitizeText(riderData.status, DEFAULT_DISPATCH_STATUS),
      zone: sanitizeText(riderData.zone, 'Unassigned coverage area'),
      vehicleType: sanitizeText(riderData.vehicleType, DEFAULT_DISPATCH_VEHICLE),
      acceptanceRate: riderData.acceptanceRate ?? null,
      completedTrips: Math.max(0, Math.floor(riderData.completedTrips ?? 0)),
      latitude:
        riderData.latitude === null || riderData.latitude === undefined
          ? null
          : parseNumber(riderData.latitude, DEFAULT_NIGERIA_COORDINATE.latitude),
      longitude:
        riderData.longitude === null || riderData.longitude === undefined
          ? null
          : parseNumber(riderData.longitude, DEFAULT_NIGERIA_COORDINATE.longitude),
      region: sanitizeOptionalText(riderData.region),
      lga: sanitizeOptionalText(riderData.lga),
      phoneNumber: sanitizeOptionalText(riderData.phoneNumber),
      currentAddress: sanitizeOptionalText(riderData.currentAddress),
      updatedAt: timestamp,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(error.message);
  }

  await broadcastRidersChanged();
};
