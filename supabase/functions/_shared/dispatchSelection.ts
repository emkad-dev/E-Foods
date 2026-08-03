// Dispatch candidate selection: picking which dispatcher owns an order and
// which rider is nearest, weighted by current load and distance.
//
// NOTE (2026-08-02): nothing in the RPC surface calls into this module today.
// `assignDispatchOwnerForOrder` was the only entrypoint and it has no caller —
// platform dispatch is shelved (restaurants self-provision delivery), so orders
// reach a dispatcher only through an explicit `dispatchAssignOrderCourier`.
// Preserved verbatim during the A1 extraction rather than deleted: it is the
// intended automatic-assignment path and deleting it is a product decision, not
// a refactor.

import { serviceClient } from './client.ts';
import { calculateDistanceKm } from './deliveryCoverage.ts';
import { DEFAULT_DISPATCH_STATUS, type DispatchRiderRow } from './dispatchRiders.ts';
import type { UserAccountRow } from './accounts.ts';
import {
  buildNotificationData,
  notifySafely,
  notifyUsers,
  sendPushNotificationsToRoles,
} from './notifications.ts';
import {
  getDispatchAssignmentOwnerId,
  insertDeliveryEvent,
  normalizeOrderStatus,
  ORDER_STATUS,
  updateOrderRecord,
  type CustomerOrderRow,
  type DeliveryAssignmentRow,
} from './orders.ts';
import { nowIso, sanitizeText, unique } from './rpc/coercion.ts';

type DispatchOwnerCandidate = {
  weight: number;
  userId: string;
};

type DispatchCourierCandidate = {
  rider: DispatchRiderRow;
  userId: string;
  weight: number;
};

const isDispatcherEligible = (account: UserAccountRow | null, rider: DispatchRiderRow | null) => {
  if (!account || account.accountDisabled === true) {
    return false;
  }

  if (!rider) {
    return false;
  }

  const riderStatus = sanitizeText(rider.status, DEFAULT_DISPATCH_STATUS);
  return riderStatus !== 'Offline';
};

const buildDispatchOwnerWeight = (rider: DispatchRiderRow | null) => {
  const activeLoad = Math.max(0, Math.floor(rider?.activeLoad ?? 0));
  return 1 / (1 + activeLoad);
};

const selectWeightedRandomCandidate = (candidates: DispatchOwnerCandidate[]) => {
  if (candidates.length === 0) {
    return null;
  }

  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (totalWeight <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }

  let cursor = Math.random() * totalWeight;
  for (const candidate of candidates) {
    cursor -= candidate.weight;
    if (cursor <= 0) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1] ?? null;
};

const loadDispatchOwnerCandidates = async (restaurantId: string | null, useRestaurantScope: boolean) => {
  if (useRestaurantScope && !restaurantId) {
    return [] as DispatchOwnerCandidate[];
  }

  const roleQuery = serviceClient.from('UserRole').select('userId,restaurantId').eq('role', 'dispatch');
  const { data: roleRows, error: roleError } = useRestaurantScope
    ? await roleQuery.eq('restaurantId', restaurantId ?? '')
    : await roleQuery;

  if (roleError) {
    throw new Error(roleError.message);
  }

  const userIds = unique(((roleRows ?? []) as { userId: string }[]).map((row) => row.userId));
  if (userIds.length === 0) {
    return [] as DispatchOwnerCandidate[];
  }

  const [{ data: accounts, error: accountError }, { data: riders, error: riderError }] = await Promise.all([
    serviceClient
      .from('UserAccount')
      .select('uid,accountDisabled')
      .in('uid', userIds),
    serviceClient
      .from('DispatchRiderRecord')
      .select('id,status,activeLoad')
      .in('id', userIds),
  ]);

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (riderError) {
    throw new Error(riderError.message);
  }

  const accountsById = new Map(((accounts ?? []) as Pick<UserAccountRow, 'uid' | 'accountDisabled'>[]).map((row) => [
    row.uid,
    row,
  ]));
  const ridersById = new Map(((riders ?? []) as Pick<DispatchRiderRow, 'activeLoad' | 'id' | 'status'>[]).map((row) => [
    row.id,
    row,
  ]));

  return userIds
    .map((userId) => {
      const account = accountsById.get(userId) ?? null;
      const rider = ridersById.get(userId) ?? null;

      if (!isDispatcherEligible(account, rider)) {
        return null;
      }

      return {
        weight: buildDispatchOwnerWeight(rider),
        userId,
      } satisfies DispatchOwnerCandidate;
    })
    .filter(Boolean) as DispatchOwnerCandidate[];
};

export const selectDispatchOwnerForRestaurant = async (restaurantId: string) => {
  const restaurantPool = await loadDispatchOwnerCandidates(restaurantId, true);
  const selectedRestaurantCandidate = selectWeightedRandomCandidate(restaurantPool);
  if (selectedRestaurantCandidate) {
    return {
      restaurantScoped: true,
      userId: selectedRestaurantCandidate.userId,
    };
  }

  const fallbackPool = await loadDispatchOwnerCandidates(null, false);
  const selectedFallbackCandidate = selectWeightedRandomCandidate(fallbackPool);
  if (selectedFallbackCandidate) {
    return {
      restaurantScoped: false,
      userId: selectedFallbackCandidate.userId,
    };
  }

  return null;
};

const buildDispatchCourierWeight = (rider: DispatchRiderRow | null, distanceKm: number | null) => {
  const activeLoad = Math.max(0, Math.floor(rider?.activeLoad ?? 0));
  const distancePenalty = distanceKm === null || !Number.isFinite(distanceKm) ? 0 : Math.min(10, distanceKm / 5);
  return 1 / (1 + activeLoad + distancePenalty);
};

const loadDispatchCourierCandidates = async (restaurantId: string) => {
  const [{ data: restaurant, error: restaurantError }, { data: roles, error: roleError }] = await Promise.all([
    serviceClient
      .from('RestaurantRecord')
      .select('id,latitude,longitude')
      .eq('id', restaurantId)
      .maybeSingle<{ id: string; latitude?: number | null; longitude?: number | null }>(),
    serviceClient.from('UserRole').select('userId').eq('role', 'dispatch'),
  ]);

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }

  if (roleError) {
    throw new Error(roleError.message);
  }

  const userIds = unique(((roles ?? []) as { userId: string }[]).map((row) => row.userId));
  if (userIds.length === 0) {
    return [] as DispatchCourierCandidate[];
  }

  const [{ data: accounts, error: accountError }, { data: riders, error: riderError }] = await Promise.all([
    serviceClient.from('UserAccount').select('uid,accountDisabled').in('uid', userIds),
    serviceClient
      .from('DispatchRiderRecord')
      .select('id,displayName,status,activeLoad,latitude,longitude')
      .in('id', userIds),
  ]);

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (riderError) {
    throw new Error(riderError.message);
  }

  const accountsById = new Map(((accounts ?? []) as Pick<UserAccountRow, 'uid' | 'accountDisabled'>[]).map((row) => [
    row.uid,
    row,
  ]));
  const ridersById = new Map(
    ((riders ?? []) as Pick<DispatchRiderRow, 'activeLoad' | 'id' | 'latitude' | 'longitude' | 'status' | 'displayName'>[]).map(
      (row) => [row.id, row]
    )
  );
  const restaurantCoordinates =
    restaurant?.latitude !== null &&
    restaurant?.latitude !== undefined &&
    restaurant?.longitude !== null &&
    restaurant?.longitude !== undefined
      ? { latitude: Number(restaurant.latitude), longitude: Number(restaurant.longitude) }
      : null;

  return userIds
    .map((userId) => {
      const account = accountsById.get(userId) ?? null;
      const rider = ridersById.get(userId) ?? null;

      if (!isDispatcherEligible(account, rider)) {
        return null;
      }

      const riderCoordinates =
        rider?.latitude !== null &&
        rider?.latitude !== undefined &&
        rider?.longitude !== null &&
        rider?.longitude !== undefined
          ? { latitude: Number(rider.latitude), longitude: Number(rider.longitude) }
          : null;
      const distanceKm =
        restaurantCoordinates && riderCoordinates
          ? calculateDistanceKm(restaurantCoordinates, riderCoordinates)
          : null;

      return {
        rider: rider as DispatchRiderRow,
        userId,
        weight: buildDispatchCourierWeight(rider, distanceKm),
      } satisfies DispatchCourierCandidate;
    })
    .filter(Boolean) as DispatchCourierCandidate[];
};

export const selectDispatchCourierForRestaurant = async (restaurantId: string) => {
  const candidates = await loadDispatchCourierCandidates(restaurantId);
  const selectedCandidate = selectWeightedRandomCandidate(candidates);

  if (!selectedCandidate) {
    return null;
  }

  return {
    rider: selectedCandidate.rider,
    userId: selectedCandidate.userId,
  };
};

/**
 * Puts an accepted delivery order into a dispatcher's queue, preferring a
 * dispatcher scoped to the restaurant and falling back to the global pool.
 * When the pool is empty it records the fact once and pages admins, rather than
 * silently leaving the order unassigned.
 */
export const assignDispatchOwnerForOrder = async (
  order: CustomerOrderRow,
  assignment: DeliveryAssignmentRow | null,
  actorUid: string,
  targetStatus: string
) => {
  const currentStatus = normalizeOrderStatus(targetStatus);
  if (![ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
    return null;
  }

  if (sanitizeText(order.fulfillmentType, 'delivery') !== 'delivery') {
    return null;
  }

  const existingOwnerId = getDispatchAssignmentOwnerId(assignment);
  if (existingOwnerId) {
    return {
      assigned: false,
      ownerId: existingOwnerId,
    };
  }

  const selectedOwner = await selectDispatchOwnerForRestaurant(order.restaurantId);
  const timestamp = nowIso();

  if (!selectedOwner) {
    const { data: existingPoolEvent, error: poolEventError } = await serviceClient
      .from('DeliveryEvent')
      .select('id')
      .eq('orderId', order.id)
      .eq('eventType', 'dispatch_pool_empty')
      .maybeSingle<{ id: string }>();

    if (poolEventError) {
      throw new Error(poolEventError.message);
    }

    if (!existingPoolEvent) {
      await insertDeliveryEvent({
        actorUid,
        details: {
          restaurantId: order.restaurantId,
        },
        eventType: 'dispatch_pool_empty',
        orderId: order.id,
      });
      await notifySafely(async () => {
        await sendPushNotificationsToRoles(['admin'], {
          body: `Order ${order.id.slice(-6).toUpperCase()} is waiting for a dispatch pool assignment.`,
          data: buildNotificationData({
            app: 'admin',
            orderId: order.id,
            restaurantId: order.restaurantId,
            routeKey: 'admin_access',
            type: 'dispatch_pool_empty',
          }),
          title: 'Dispatch pool empty',
        });
      });
    }

    return null;
  }

  const { error } = await serviceClient.from('DeliveryAssignment').upsert(
    {
      assignedAt: assignment?.assignedAt ?? timestamp,
      courierId: sanitizeText(assignment?.courierId),
      courierName: sanitizeText(assignment?.courierName),
      dispatchId: sanitizeText(assignment?.dispatchId),
      dispatchOwnerId: selectedOwner.userId,
      orderId: order.id,
      updatedAt: timestamp,
    },
    { onConflict: 'orderId' }
  );

  if (error) {
    throw new Error(error.message);
  }

  await updateOrderRecord(order.id, {
    updatedAt: timestamp,
  });

  await insertDeliveryEvent({
    actorUid,
    details: {
      dispatchOwnerId: selectedOwner.userId,
      restaurantId: order.restaurantId,
      restaurantScoped: selectedOwner.restaurantScoped,
    },
    eventType: 'dispatch_assigned',
    orderId: order.id,
  });

  await notifyUsers([selectedOwner.userId], {
    title: 'New dispatch order',
    body: `Order ${order.id.slice(-6).toUpperCase()} is now in your queue.`,
    data: buildNotificationData({
      app: 'dispatch',
      orderId: order.id,
      routeKey: 'dispatch_delivery_detail',
      type: 'dispatch_assignment',
    }),
  });

  return {
    assigned: true,
    ownerId: selectedOwner.userId,
  };
};
