// Dispatch domain: the dispatcher's delivery queue, rider records and
// locations, courier assignment, delivery status transitions, weekly earnings,
// and the rider onboarding application.

import { loadUserAccount, loadUserPhoneNumber, syncUserRoleState, upsertUserAccount } from '../accounts.ts';
import { DISPATCH_APPLICATION_STATUS, loadDispatchApplication } from '../applications.ts';
import { createAuditEntry } from '../auditLog.ts';
import { serviceClient } from '../client.ts';
import {
  buildCourierWeeklyEarningsSummary,
  loadCourierEarnings,
  loadCourierPayouts,
  loadCourierShiftSlots,
  upsertCourierShiftSlots,
  uploadDispatchDocument,
} from '../courierSupply.ts';
import { recordDispatchRiderPing } from '../dispatchRiderPings.ts';
import { broadcastRiderPositionToActiveOrders } from '../riderPositionBroadcast.ts';
import {
  DEFAULT_DISPATCH_STATUS,
  DEFAULT_DISPATCH_VEHICLE,
  DISPATCH_RIDER_COLUMNS,
  buildDispatchRiderResponse,
  ensureDispatchRiderRecord,
  type DispatchRiderRow,
} from '../dispatchRiders.ts';
import {
  acceptDispatchOffer,
  buildDispatchOfferResponse,
  declineDispatchOffer,
  loadManualQueueOrderIds,
  loadPendingOffersForCourier,
  supersedePendingOffersForOrder,
} from '../dispatchOffers.ts';
import {
  reassignDispatchAssignmentCourier,
  releaseDispatchAssignmentLoad,
  reofferDispatchOrder,
} from '../dispatchSelection.ts';
import { getNigeriaAreaCoordinate } from '../nigeriaGeography.ts';
import { buildNotificationData, notifyAdmins, notifyRestaurantUsers, notifyUsers } from '../notifications.ts';
import { logEdgeEvent } from '../observability.ts';
import {
  CUSTOMER_ORDER_COLUMNS,
  DEFAULT_CURRENCY,
  ORDER_STATUS,
  PAYMENT_PROVIDER_CASH,
  PAYMENT_STATUS,
  TERMINAL_ORDER_STATUSES,
  assertNonTerminalOrder,
  assertOrderPaymentReadyForOperations,
  getDispatchAssignmentOwnerId,
  hasAssignedCourier,
  insertDeliveryEvent,
  isOrderOperationallyVisible,
  loadOrderBundle,
  loadOrderRelations,
  maybeExpireUnpaidOrder,
  normalizeOrderStatus,
  toOrderSnapshotResponse,
  updateOrderRecord,
  type CustomerOrderRow,
  type DeliveryAssignmentRow,
} from '../orders.ts';
import { loadDispatchWeights } from '../platformSettings.ts';
import { recordPolicyAcceptance, validatePolicyAcceptancePayload } from '../policyAcceptance.ts';
import { broadcastOrderChanged, broadcastRidersChanged } from '../realtime.ts';
import { DISPATCH_ACTIONS } from '../rpc/actions.ts';
import type { JsonObject } from '../rpc/coercion.ts';
import {
  nowIso,
  parseInteger,
  parseNumber,
  roundCurrency,
  sanitizeOptionalText,
  sanitizeText,
  toSortableTimestamp,
} from '../rpc/coercion.ts';
import { ensureRole, type AuthenticatedRequestContext } from '../rpc/context.ts';
import { defineRpcDomain, type RpcHandler } from '../rpc/registry.ts';
import { fail, json } from '../rpc/respond.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

// Widened to readonly string[] so `.includes(normalizeOrderStatus(...))`
// type-checks - the same widening AUTO_DISPATCH_ELIGIBLE_STATUSES uses in
// dispatchSelection.ts. Without it TS infers a literal union and rejects
// the general string.
const UNOWNED_DISPATCHABLE_STATUSES: readonly string[] = [
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
];

/**
 * An order that no dispatcher owns and no rider holds, that has genuinely
 * fallen through to the manual dispatch queue, sitting in a status where a
 * courier could still be placed on it.
 *
 * This exists because of how exhaustion actually terminates (Task 10 / D2).
 * When every offer is declined or lapses, there is BY DEFINITION no dispatch
 * owner - an owner is only ever stamped by a claim or a manual assignment, and
 * exhaustion is the state where neither happened. The brief calls for such an
 * order to "fall back to the dispatch owner's manual queue", which cannot mean
 * a specific owner's queue; the only coherent reading is that it becomes
 * unowned work any dispatcher can pick up.
 *
 * Without this predicate the ownership filter below silently swallows those
 * orders: `getDispatchAssignmentOwnerId` returns '' for a missing assignment
 * row (sanitizeText never yields null), and '' never equals a uid - so an
 * exhausted order would be visible to admins only, and every dispatcher would
 * be 403'd from assigning it by hand. A restaurant could accept an order,
 * every rider decline it, and with no admin on shift nobody holding the
 * dispatch role could even see it.
 *
 * THE `inManualQueue` GATE IS LOAD-BEARING, and its absence was review round
 * 2's Defect 1. "No owner, no courier" is NOT enough on its own: an order in
 * the middle of a live 45s offer to a specific rider ALSO has no assignment
 * row - the claim is not created until accept - so a predicate keyed only off
 * ownership matched an actively-offered order, and any other dispatcher could
 * see it, open it, and self-assign it, superseding the offeree's exclusive
 * window and bypassing the ranked auto-offer. The caller must pass the result
 * of loadManualQueueOrderIds for this order: true only when a
 * `dispatch_offers_exhausted` marker exists AND no live pending offer is
 * outstanding (see loadManualQueueOrderIds for why both are required). An
 * order merely "between offers", or one that exhausted early but is now being
 * offered to a newly-online rider, is deliberately excluded.
 *
 * Deliberately narrow: it widens an OWNERSHIP check only, and only for orders
 * with no owner and no courier at all that have reached the manual queue. Every
 * status and payment gate (assertNonTerminalOrder,
 * assertOrderPaymentReadyForOperations, the ACCEPTED/PREPARING/READY_FOR_PICKUP
 * window) is untouched and still applies.
 */
const isUnownedDispatchableOrder = (
  order: CustomerOrderRow,
  assignment: DeliveryAssignmentRow | null,
  inManualQueue: boolean
) => {
  if (!inManualQueue) {
    return false;
  }

  if (sanitizeText(assignment?.courierId) || getDispatchAssignmentOwnerId(assignment)) {
    return false;
  }

  if (sanitizeText(order.fulfillmentType, 'delivery') !== 'delivery') {
    return false;
  }

  return UNOWNED_DISPATCHABLE_STATUSES.includes(normalizeOrderStatus(order.status));
};

const getDispatchQueuePriority = (order: CustomerOrderRow, assignment: DeliveryAssignmentRow | null) => {
  const status = normalizeOrderStatus(order.status);
  const hasCourier = Boolean(sanitizeText(assignment?.courierId));

  if (status === ORDER_STATUS.ESCALATED) {
    return 0;
  }

  if (!hasCourier && [ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(status)) {
    return 1;
  }

  if (!hasCourier && status === ORDER_STATUS.PLACED) {
    return 2;
  }

  if (hasCourier && [ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(status)) {
    return 3;
  }

  if ([ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY].includes(status)) {
    return 4;
  }

  return 5;
};

const LAGOS_TIME_OFFSET_MS = 60 * 60 * 1000;

/** Monday 00:00 to Monday 00:00 in Africa/Lagos, expressed as UTC instants. */
const getLagosWeekWindow = (date = new Date()) => {
  const lagosNow = new Date(date.getTime() + LAGOS_TIME_OFFSET_MS);
  const day = lagosNow.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const startLocalMs = Date.UTC(
    lagosNow.getUTCFullYear(),
    lagosNow.getUTCMonth(),
    lagosNow.getUTCDate() - daysSinceMonday,
    0,
    0,
    0,
    0
  );
  const endLocalMs = startLocalMs + 7 * 24 * 60 * 60 * 1000;

  return {
    endsAt: new Date(endLocalMs - LAGOS_TIME_OFFSET_MS).toISOString(),
    startsAt: new Date(startLocalMs - LAGOS_TIME_OFFSET_MS).toISOString(),
    timezone: 'Africa/Lagos',
  };
};

const getOrderDeliveredAt = (order: CustomerOrderRow) =>
  sanitizeOptionalText(order.timeline?.deliveredAt) ??
  sanitizeOptionalText(order.updatedAt) ??
  sanitizeOptionalText(order.createdAt);

const isIsoDateInWindow = (value: string | null | undefined, startsAt: string, endsAt: string) => {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= Date.parse(startsAt) && timestamp < Date.parse(endsAt);
};

const buildDispatchStatusUpdate = (
  currentStatus: string,
  assignment: DeliveryAssignmentRow | null,
  action: string
) => {
  const time = nowIso();

  switch (action) {
    case 'picked_up':
      if (currentStatus !== ORDER_STATUS.READY_FOR_PICKUP) {
        fail(412, 'Pickup can only be confirmed after the restaurant marks the order ready.');
      }

      if (!hasAssignedCourier(assignment)) {
        fail(412, 'Assign a rider before confirming pickup.');
      }

      return {
        status: ORDER_STATUS.PICKED_UP,
        timelinePatch: { pickedUpAt: time },
      };
    case 'on_the_way':
      if (currentStatus !== ORDER_STATUS.PICKED_UP) {
        fail(412, 'Only picked-up orders can move to the on-the-way stage.');
      }

      if (!hasAssignedCourier(assignment)) {
        fail(412, 'Assign a rider before marking the order on the way.');
      }

      return {
        status: ORDER_STATUS.ON_THE_WAY,
        timelinePatch: { onTheWayAt: time },
      };
    case 'delivered':
      if (![ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY].includes(currentStatus)) {
        fail(412, 'Only picked-up delivery orders can be marked delivered.');
      }

      if (!hasAssignedCourier(assignment)) {
        fail(412, 'Assign a rider before completing delivery.');
      }

      return {
        status: ORDER_STATUS.DELIVERED,
        timelinePatch: { deliveredAt: time },
      };
    case 'failed_delivery':
      if (![ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY].includes(currentStatus)) {
        fail(412, 'Only rider-active delivery orders can be marked as failed.');
      }

      if (!hasAssignedCourier(assignment)) {
        fail(412, 'Assign a rider before marking delivery as failed.');
      }

      return {
        status: ORDER_STATUS.FAILED_DELIVERY,
        timelinePatch: { failedDeliveryAt: time },
      };
    case 'escalate':
      if (TERMINAL_ORDER_STATUSES.has(currentStatus)) {
        fail(412, 'Completed or cancelled orders cannot be escalated.');
      }

      return {
        status: ORDER_STATUS.ESCALATED,
        timelinePatch: { escalatedAt: time },
      };
    default:
      fail(400, 'Unsupported dispatch order action.');
  }
};

const normalizeDispatchRiderDraft = (input: Record<string, unknown>) => {
  const displayName = sanitizeText(input.name ?? input.displayName);
  const zone = sanitizeText(input.zone);
  const lga = sanitizeText(input.lga);
  const status = sanitizeText(input.status, DEFAULT_DISPATCH_STATUS);
  const vehicleType = sanitizeText(input.vehicleType, DEFAULT_DISPATCH_VEHICLE);
  const activeLoad = parseInteger(input.activeLoad, 0);
  const completedTrips = parseInteger(input.completedTrips, 0);
  const acceptanceRateRaw = parseNumber(input.acceptanceRate, Number.NaN);
  const acceptanceRate = Number.isFinite(acceptanceRateRaw) ? acceptanceRateRaw : null;
  const latitude =
    input.latitude === null || input.latitude === undefined ? null : parseNumber(input.latitude, Number.NaN);
  const longitude =
    input.longitude === null || input.longitude === undefined ? null : parseNumber(input.longitude, Number.NaN);

  if (!displayName) {
    fail(400, 'Rider name is required.');
  }

  if (!zone) {
    fail(400, 'Rider zone is required.');
  }

  if (!lga) {
    fail(400, 'Rider LGA is required.');
  }

  if (activeLoad < 0 || completedTrips < 0) {
    fail(400, 'Rider load and trip counters cannot be negative.');
  }

  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;

  if (hasLatitude !== hasLongitude) {
    fail(400, 'Provide both rider latitude and longitude together.');
  }

  if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    fail(400, 'Use valid numeric coordinates for the rider.');
  }

  return {
    acceptanceRate,
    activeLoad,
    completedTrips,
    currentAddress: sanitizeOptionalText(input.currentAddress),
    displayName,
    lga,
    latitude,
    longitude,
    phoneNumber: sanitizeOptionalText(input.phoneNumber),
    region: zone,
    status,
    vehicleType,
    zone,
  };
};

const dispatchGetDeliveryQueue: Handler = async ({ context }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const { data: orders, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .eq('fulfillmentType', 'delivery')
    .order('createdAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const orderList = (await Promise.all(((orders ?? []) as CustomerOrderRow[]).map((order) => maybeExpireUnpaidOrder(order))))
    .filter(isOrderOperationallyVisible);
  const { assignmentsByOrderId, itemsByOrderId } = await loadOrderRelations(orderList.map((order) => order.id));
  const sortedOrderList = [...orderList].sort((left, right) => {
    const leftStatus = normalizeOrderStatus(left.status);
    const rightStatus = normalizeOrderStatus(right.status);
    const leftTerminal = TERMINAL_ORDER_STATUSES.has(leftStatus);
    const rightTerminal = TERMINAL_ORDER_STATUSES.has(rightStatus);

    if (leftTerminal !== rightTerminal) {
      return leftTerminal ? 1 : -1;
    }

    if (leftTerminal && rightTerminal) {
      return toSortableTimestamp(right.updatedAt ?? right.createdAt) - toSortableTimestamp(left.updatedAt ?? left.createdAt);
    }

    const priorityDelta =
      getDispatchQueuePriority(left, assignmentsByOrderId.get(left.id) ?? null) -
      getDispatchQueuePriority(right, assignmentsByOrderId.get(right.id) ?? null);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return toSortableTimestamp(left.createdAt) - toSortableTimestamp(right.createdAt);
  });
  // Which of these orders have actually reached the manual queue (exhausted
  // and not under a live offer). Admins see everything, so they never need it.
  // Computed in one batched pair of reads rather than per-order - see
  // loadManualQueueOrderIds. This is the gate that keeps an actively-offered
  // order OUT of every other dispatcher's queue (review round 2, Defect 1).
  const manualQueueOrderIds =
    context.role === 'admin'
      ? new Set<string>()
      : await loadManualQueueOrderIds(orderList.map((order) => order.id));
  const scopedOrderList =
    context.role === 'admin'
      ? sortedOrderList
      : sortedOrderList.filter((order) => {
          const assignment = assignmentsByOrderId.get(order.id) ?? null;
          // Their own queue, plus unowned work that auto-offer gave up on - see
          // isUnownedDispatchableOrder for why exhaustion produces the latter,
          // and why an order still inside a live offer window is NOT here.
          return (
            getDispatchAssignmentOwnerId(assignment) === context.uid ||
            isUnownedDispatchableOrder(order, assignment, manualQueueOrderIds.has(order.id))
          );
        });

  // Live offers for THIS rider (Task 10 / D2). Carried alongside `orders`
  // rather than inside it because an offered order is deliberately kept OUT of
  // the `orders` scoped list above: it has no DeliveryAssignment yet, but the
  // manual-queue gate (loadManualQueueOrderIds requires an exhaustion marker
  // AND no live offer) excludes an order that is still inside its offer window,
  // so a live-offered order reaches its offeree only through THIS array and
  // never as unowned queue work for some other dispatcher to grab. Admins get
  // no offers array content: offers belong to a specific rider.
  //
  // Each entry embeds the order snapshot so the offer screen can render a
  // summary and a distance without a second round trip inside a 45s window.
  const pendingOffers = context.role === 'admin' ? [] : await loadPendingOffersForCourier(context.uid);
  const offerOrderIds = pendingOffers.map((offer) => offer.orderId).filter(Boolean);

  let offerOrdersById = new Map<string, CustomerOrderRow>();
  let offerRelations: Awaited<ReturnType<typeof loadOrderRelations>> | null = null;

  if (offerOrderIds.length > 0) {
    const { data: offerOrders, error: offerOrdersError } = await serviceClient
      .from('CustomerOrder')
      .select(CUSTOMER_ORDER_COLUMNS)
      .in('id', offerOrderIds);

    if (offerOrdersError) {
      throw new Error(offerOrdersError.message);
    }

    offerOrdersById = new Map(((offerOrders ?? []) as CustomerOrderRow[]).map((order) => [order.id, order]));
    offerRelations = await loadOrderRelations([...offerOrdersById.keys()]);
  }

  return json(200, {
    data: {
      offers: pendingOffers
        .map((offer) => {
          const order = offerOrdersById.get(offer.orderId);
          // An offer whose order vanished (hard-deleted in a support action)
          // is dropped rather than rendered as an empty card.
          if (!order) {
            return null;
          }

          return {
            ...buildDispatchOfferResponse(offer),
            order: toOrderSnapshotResponse(
              order,
              offerRelations?.itemsByOrderId.get(order.id) ?? [],
              offerRelations?.assignmentsByOrderId.get(order.id) ?? null
            ),
          };
        })
        .filter((offer) => offer !== null),
      orders: scopedOrderList.map((order) =>
        toOrderSnapshotResponse(
          order,
          itemsByOrderId.get(order.id) ?? [],
          assignmentsByOrderId.get(order.id) ?? null
        )
      ),
    },
  });
};

const dispatchGetRiders: Handler = async ({ context }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const { data: riders, error } = await serviceClient
    .from('DispatchRiderRecord')
    .select(DISPATCH_RIDER_COLUMNS)
    .order('updatedAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return json(200, {
    data: {
      riders: ((riders ?? []) as DispatchRiderRow[]).map((rider) => buildDispatchRiderResponse(rider)),
    },
  });
};

const dispatchGetWeeklyEarnings: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const requestedCourierId = sanitizeText(data.courierId);
  const courierId = context.role === 'admin' && requestedCourierId ? requestedCourierId : context.uid;
  const weekWindow = getLagosWeekWindow();
  const records = await loadCourierEarnings(courierId, weekWindow.startsAt, weekWindow.endsAt);
  const payouts = await loadCourierPayouts(courierId);
  const summary = buildCourierWeeklyEarningsSummary({ payouts, records, weekWindow });

  return json(200, {
    data: summary,
  });
};

const dispatchGetShiftSlots: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const requestedCourierId = sanitizeText(data.courierId);
  const courierId = context.role === 'admin' && requestedCourierId ? requestedCourierId : context.uid;
  const slots = await loadCourierShiftSlots(courierId);

  return json(200, {
    data: {
      courierId,
      slots,
    },
  });
};

const dispatchUpsertShiftSlots: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const requestedCourierId = sanitizeText(data.courierId);
  const courierId = context.role === 'admin' && requestedCourierId ? requestedCourierId : context.uid;
  const slots = Array.isArray(data.slots) ? data.slots : [];

  if (slots.length === 0) {
    fail(400, 'Add at least one shift slot before saving.');
  }

  await upsertCourierShiftSlots(
    courierId,
    slots.map((slot) => ({
      endsAt: sanitizeText((slot as JsonObject).endsAt),
      forecastDemand: parseNumber((slot as JsonObject).forecastDemand, 0),
      id: sanitizeOptionalText((slot as JsonObject).id) ?? undefined,
      notes: sanitizeOptionalText((slot as JsonObject).notes),
      startsAt: sanitizeText((slot as JsonObject).startsAt),
      status: sanitizeOptionalText((slot as JsonObject).status) ?? undefined,
    }))
  );

  const savedSlots = await loadCourierShiftSlots(courierId);

  return json(200, {
    data: {
      courierId,
      slots: savedSlots,
    },
  });
};

const dispatchGetOrderDetail: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const orderId = sanitizeText(data.orderId);
  if (!orderId) {
    fail(400, 'An order id is required.');
  }

  const bundle = await loadOrderBundle(orderId, true);
  if (!bundle) {
    fail(404, 'The selected order could not be found.');
  }

  assertOrderPaymentReadyForOperations(bundle.order);
  const dispatchOwnerId = getDispatchAssignmentOwnerId(bundle.assignment ?? null);
  if (context.role !== 'admin' && dispatchOwnerId !== context.uid) {
    const inManualQueue = (await loadManualQueueOrderIds([orderId])).has(orderId);
    // bundle! : narrowed non-null by the fail() guard above (fail returns never),
    // a narrowing deno check does not carry across the awaits in between - the
    // file's pre-existing, already-baselined pattern.
    if (!isUnownedDispatchableOrder(bundle!.order, bundle!.assignment ?? null, inManualQueue)) {
      fail(403, 'This delivery is not assigned to your dispatcher queue.');
    }
  }

  const customerPhone = await loadUserPhoneNumber(bundle.order.customerId);

  return json(200, {
    data: {
      order: toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment, bundle.events, {
        customerPhone,
      }),
    },
  });
};

const upsertDispatchRiderProfile: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const requestedRiderId = sanitizeText(data.riderId);
  const riderId = requestedRiderId || (context.role === 'dispatch' ? context.uid : crypto.randomUUID());
  const draft = normalizeDispatchRiderDraft(data);
  let persistedDraft = draft;

  if (context.role === 'dispatch') {
    if (riderId !== context.uid) {
      fail(403, 'Dispatch riders can only update their own rider profile.');
    }

    // A rider may edit coverage, not their own performance counters or status.
    const { data: existingRider, error } = await serviceClient
      .from('DispatchRiderRecord')
      .select(
        'id,displayName,status,zone,vehicleType,acceptanceRate,activeLoad,completedTrips,latitude,longitude,region,lga,phoneNumber,currentAddress,createdAt,updatedAt'
      )
      .eq('id', riderId)
      .maybeSingle<DispatchRiderRow>();

    if (error) {
      throw new Error(error.message);
    }

    persistedDraft = {
      acceptanceRate: existingRider?.acceptanceRate ?? 100,
      activeLoad: existingRider?.activeLoad ?? 0,
      completedTrips: existingRider?.completedTrips ?? 0,
      currentAddress: existingRider?.currentAddress ?? draft.currentAddress ?? null,
      displayName: existingRider?.displayName ?? draft.displayName,
      lga: draft.lga,
      latitude: draft.latitude,
      longitude: draft.longitude,
      phoneNumber: existingRider?.phoneNumber ?? draft.phoneNumber ?? null,
      region: draft.region,
      status: existingRider?.status ?? draft.status,
      vehicleType: existingRider?.vehicleType ?? draft.vehicleType,
      zone: draft.zone,
    };
  }

  const timestamp = nowIso();
  const { error } = await serviceClient.from('DispatchRiderRecord').upsert(
    {
      id: riderId,
      displayName: persistedDraft.displayName,
      status: persistedDraft.status,
      zone: persistedDraft.zone,
      vehicleType: persistedDraft.vehicleType,
      acceptanceRate: persistedDraft.acceptanceRate,
      activeLoad: persistedDraft.activeLoad,
      completedTrips: persistedDraft.completedTrips,
      latitude: persistedDraft.latitude,
      longitude: persistedDraft.longitude,
      region: persistedDraft.region,
      lga: persistedDraft.lga,
      phoneNumber: persistedDraft.phoneNumber,
      currentAddress: persistedDraft.currentAddress,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(error.message);
  }

  await broadcastRidersChanged();

  await createAuditEntry(context.uid, 'dispatch_rider_upserted', 'dispatch_rider', riderId, {
    status: persistedDraft.status,
    zone: persistedDraft.zone,
  });

  return json(200, {
    data: {
      rider: buildDispatchRiderResponse({
        id: riderId,
        updatedAt: timestamp,
        ...persistedDraft,
      }),
    },
  });
};

const syncDispatchRiderLocation: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const requestedRiderId = sanitizeText(data.riderId);
  const riderId = context.role === 'admin' ? requestedRiderId || context.uid : context.uid;
  const latitude = parseNumber(data.latitude, Number.NaN);
  const longitude = parseNumber(data.longitude, Number.NaN);
  if (!riderId) {
    fail(400, 'A rider id is required.');
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    fail(400, 'A valid rider location is required.');
  }

  const { data: existingRider, error: riderError } = await serviceClient
    .from('DispatchRiderRecord')
    .select('id')
    .eq('id', riderId)
    .maybeSingle<{ id: string }>();

  if (riderError) {
    throw new Error(riderError.message);
  }

  if (!existingRider) {
    fail(404, 'The selected rider could not be found.');
  }

  const timestamp = nowIso();
  const { error } = await serviceClient
    .from('DispatchRiderRecord')
    .update({
      latitude,
      longitude,
      updatedAt: timestamp,
    })
    .eq('id', riderId);

  if (error) {
    throw new Error(error.message);
  }

  const accuracy = parseNumber(data.accuracy, null);

  // The current-position update above happens on EVERY call, unthrottled -
  // a rider's last-known location must always be fresh regardless of ping
  // cadence. The history append below is the throttled part (at most one row
  // every DISPATCH_RIDER_PING_THROTTLE_SECONDS per rider, enforced in SQL
  // under a per-rider advisory lock - see 20260820_dispatch_rider_ping.sql).
  //
  // Non-fatal and logged, never re-thrown: the position sync above has
  // already committed, and a client polling every few seconds must not start
  // seeing errors just because the history append hit a throttle-adjacent
  // hiccup. `recorded: false` (throttled) is itself the expected, common
  // outcome and is not an error at all - only a genuine DB failure reaches
  // this catch.
  let pingRecorded = false;
  try {
    const pingResult = await recordDispatchRiderPing(riderId, latitude, longitude, accuracy);
    pingRecorded = pingResult.recorded;
  } catch (pingError) {
    logEdgeEvent('error', 'dispatch rider ping append failed', {
      action: 'syncDispatchRiderLocation',
      error: pingError instanceof Error ? pingError.message : String(pingError),
      riderId,
    });
  }

  // Push the new position to the customer(s) waiting on this rider, but ONLY
  // when a ping was actually recorded - that reuses the SQL 10s-per-rider
  // throttle so the customer gets one position broadcast per 10s per order,
  // without a second timer. Best-effort like every _shared/realtime.ts
  // broadcast: the position sync above has already committed, so a failed
  // fan-out is logged and swallowed, never re-thrown.
  if (pingRecorded) {
    try {
      await broadcastRiderPositionToActiveOrders({
        latitude,
        longitude,
        riderId,
        updatedAt: timestamp,
      });
    } catch (broadcastError) {
      logEdgeEvent('error', 'dispatch rider position broadcast failed', {
        action: 'syncDispatchRiderLocation',
        error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
        riderId,
      });
    }
  }

  return json(200, {
    data: {
      accuracy,
      latitude,
      longitude,
      pingRecorded,
      riderId,
      timestamp,
    },
  });
};

const dispatchAssignOrderCourier: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const orderId = sanitizeText(data.orderId);
  const courierId = sanitizeText(data.courierId);
  if (!orderId || !courierId) {
    fail(400, 'Order id and courier id are required.');
  }

  const bundle = await loadOrderBundle(orderId);
  if (!bundle) {
    fail(404, 'The selected order could not be found.');
  }

  const dispatchOwnerId = getDispatchAssignmentOwnerId(bundle.assignment ?? null);
  // Unowned MANUAL-QUEUE work is assignable by any dispatcher - that is what
  // makes the exhaustion fallback reachable without an admin on shift. See
  // isUnownedDispatchableOrder; the manual-queue gate (exhaustion marker AND no
  // live offer) is what stops this being a way to grab an order that is
  // currently offered to a specific rider.
  if (context.role !== 'admin' && dispatchOwnerId !== context.uid) {
    const inManualQueue = (await loadManualQueueOrderIds([orderId])).has(orderId);
    // bundle! : narrowed non-null by the fail() guard above (fail returns never),
    // a narrowing deno check does not carry across the awaits in between - the
    // file's pre-existing, already-baselined pattern.
    if (!isUnownedDispatchableOrder(bundle!.order, bundle!.assignment ?? null, inManualQueue)) {
      fail(403, 'This delivery is not assigned to your dispatcher queue.');
    }
  }

  const { data: courier, error: courierError } = await serviceClient
    .from('DispatchRiderRecord')
    .select(DISPATCH_RIDER_COLUMNS)
    .eq('id', courierId)
    .maybeSingle<DispatchRiderRow>();

  if (courierError) {
    throw new Error(courierError.message);
  }

  if (!courier) {
    fail(404, 'The selected rider could not be found.');
  }

  assertNonTerminalOrder(bundle.order);
  assertOrderPaymentReadyForOperations(bundle.order);

  const currentStatus = normalizeOrderStatus(bundle.order.status);
  if (![ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
    fail(412, 'Wait for the restaurant to accept the order before assigning a rider.');
  }

  if (sanitizeText(bundle.order.fulfillmentType, 'delivery') !== 'delivery') {
    fail(412, 'Only delivery orders can be assigned to riders.');
  }

  const assignedAt = nowIso();
  const courierName = sanitizeText(courier.displayName, `Rider ${courier.id.slice(-4)}`);

  // One compare-and-swap, not an upsert followed by two load adjustments
  // (review round 4). Every check above this line - assertNonTerminalOrder,
  // the ACCEPTED/PREPARING/READY_FOR_PICKUP gate, the ownership check - reads
  // `bundle`, a snapshot taken at the top of this handler, and none of the
  // writes underneath used to be conditioned on the order's committed state.
  // A reassignment A->B racing a terminal transition therefore leaked B's
  // load permanently in BOTH orderings: with the terminal transition first,
  // the upsert cleared loadReleasedAt back to null and incremented B on an
  // order that will never transition again; with the reassignment first, the
  // terminal transition's release passed its own stale courier id A, matched
  // no row, and decremented nothing. Neither is recoverable - a terminal
  // order gets no further transitions - which made it worse than the
  // over/under-counts of rounds 1-3.
  //
  // ebuy_reassign_dispatch_assignment_courier does the row swap, A's
  // decrement and B's increment in one transaction, conditioned on the
  // order's *currently committed* status (locked, same normalization as
  // normalizeOrderStatus) and on the claim not having already been released.
  // dispatchOwnerId is set to the new courier for the reason it always was:
  // one `dispatch` role, no separate coordinator type, so the rider working
  // an order and the account whose queue it appears in
  // (dispatchGetDeliveryQueue's ownership filter, and every 403 check on the
  // dispatch status/detail actions) must be the same account.
  const reassignment = await reassignDispatchAssignmentCourier(orderId, courier.id, courierName, context.uid);

  // Fail, never no-op. This is a synchronous human action, and every side
  // effect below assumes the swap happened: a 200 would tell the dispatcher
  // their rider is on the order, push "Rider assigned" to that rider and the
  // customer, and log a courier_reassigned event, for an assignment the
  // database refused. Failing also keeps one behaviour for one precondition -
  // the client sees the same 412 class whether the order went terminal
  // before the handler's snapshot (assertNonTerminalOrder / the status gate
  // above) or between that snapshot and this write.
  if (!reassignment.reassigned) {
    fail(412, 'This order changed while the rider was being assigned. Reload the delivery and try again.');
  }

  // This order now has a rider by human decision, so any offer still sitting
  // on somebody's screen is dead - close it out rather than leaving a rider
  // running a countdown for work that is already assigned. Ledger-neutral (a
  // pending offer never carried a claim) and non-fatal: the assignment has
  // already committed, and a cosmetic tidy-up must not fail it.
  try {
    await supersedePendingOffersForOrder(orderId);
  } catch (error) {
    logEdgeEvent('error', 'superseding pending offers after manual assignment failed', {
      action: 'dispatchAssignOrderCourier',
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
  }

  // The authoritative previous courier, read under the same lock that
  // performed the swap - not sanitizeText(bundle.assignment?.courierId),
  // which is the stale value this round's bug was built on.
  const previousCourierId = sanitizeText(reassignment.previousCourierId);
  const wasReassigned = Boolean(
    previousCourierId && previousCourierId !== courier.id
  );

  await updateOrderRecord(orderId, {
    updatedAt: assignedAt,
  });

  // dispatchAssignOrderCourier is the manual override of automatic dispatch
  // assignment (see runAutomaticDispatchAssignment in dispatchSelection.ts):
  // it always logs courier_reassigned with reason: 'manual_override', even
  // on a first-ever assignment for this order, so the event log can always
  // distinguish "a human picked this rider" from the automatic path's
  // dispatch_assigned events by eventType/reason alone.
  await insertDeliveryEvent({
    orderId,
    eventType: 'courier_reassigned',
    actorUid: context.uid,
    details: {
      courierId: courier.id,
      courierName,
      previousCourierId: previousCourierId || null,
      reason: 'manual_override',
    },
  });
  await notifyUsers([bundle.order.customerId], {
    title: wasReassigned ? 'Rider reassigned' : 'Rider assigned',
    body: `${courierName} has been assigned to order ${orderId.slice(-6).toUpperCase()}.`,
    data: buildNotificationData({
      app: 'customer',
      orderId,
      routeKey: 'customer_order_detail',
      status: normalizeOrderStatus(bundle.order.status),
      type: 'order_update',
    }),
  });
  await notifyUsers([courier.id], {
    title: 'New delivery assignment',
    body: `You were assigned to order ${orderId.slice(-6).toUpperCase()}.`,
    data: buildNotificationData({
      app: 'dispatch',
      orderId,
      routeKey: 'dispatch_delivery_detail',
      type: 'dispatch_assignment',
    }),
  });

  return json(200, {
    data: {
      courierId: courier.id,
      courierName,
      orderId,
      wasReassigned,
    },
  });
};

const dispatchUpdateOrderStatus: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const orderId = sanitizeText(data.orderId);
  const nextAction = sanitizeText(data.action);
  if (!orderId) {
    fail(400, 'An order id is required.');
  }

  const bundle = await loadOrderBundle(orderId);
  if (!bundle) {
    fail(404, 'The selected order could not be found.');
  }

  assertNonTerminalOrder(bundle.order);
  assertOrderPaymentReadyForOperations(bundle.order);
  const dispatchOwnerId = getDispatchAssignmentOwnerId(bundle.assignment ?? null);
  if (context.role !== 'admin' && dispatchOwnerId !== context.uid) {
    // `escalate` is the ONE transition here that needs no courier (see
    // buildDispatchStatusUpdate - picked_up/on_the_way/delivered/failed_delivery
    // all require hasAssignedCourier, escalate does not), so it is the one
    // action a plain dispatcher may take on an unowned manual-queue order.
    // Escalation is the most useful action on a rider-less stuck order; without
    // this, the very orders round-1's fix surfaced (exhausted, owner-less) could
    // be opened but every action on them 403'd (review round 2, Defect 2). All
    // courier-requiring transitions stay 403'd - an unowned order has no rider
    // to have picked anything up - because they fail the `escalate` check here.
    const canEscalateUnowned =
      nextAction === 'escalate' &&
      isUnownedDispatchableOrder(
        bundle!.order,
        bundle!.assignment ?? null,
        (await loadManualQueueOrderIds([orderId])).has(orderId)
      );
    if (!canEscalateUnowned) {
      fail(403, 'This delivery is not assigned to your dispatcher queue.');
    }
  }

  if (sanitizeText(bundle.order.fulfillmentType, 'delivery') !== 'delivery') {
    fail(412, 'Dispatch actions are only available for delivery orders.');
  }

  const currentStatus = normalizeOrderStatus(bundle.order.status);
  const nextState = buildDispatchStatusUpdate(currentStatus, bundle.assignment, nextAction);
  const timeline = {
    ...(bundle.order.timeline ?? {}),
    ...nextState.timelinePatch,
  };
  const payment = { ...(bundle.order.payment ?? {}) } as JsonObject;

  if (nextAction === 'delivered' && sanitizeText(payment.method, 'cash') === 'cash') {
    payment.capturedAmount = roundCurrency(parseNumber((bundle.order.pricing ?? {}).total, 0));
    payment.lastEvent = 'cash_collected_on_delivery';
    payment.paidAt = nowIso();
    payment.processor = PAYMENT_PROVIDER_CASH;
    payment.reference = sanitizeText(payment.reference, `CASH-${orderId.slice(-6).toUpperCase()}`);
    payment.status = PAYMENT_STATUS.PAID;
  }

  await updateOrderRecord(orderId, {
    payment,
    status: nextState.status,
    timeline,
    updatedAt: nowIso(),
  });

  // Routed through releaseDispatchAssignmentLoad, not the plain
  // adjustDispatchRiderLoad(-1) this used to call: this is the
  // dispatcher-driven half of the same release the partner-driven
  // DELIVERED/REJECTED transition in partnerUpdateOrderStatus makes
  // (review round 2). The two paths have disjoint FSM guards (this one only
  // reaches DELIVERED/FAILED_DELIVERY from PICKED_UP/ON_THE_WAY; the
  // partner one only reaches DELIVERED/REJECTED from
  // PREPARING/READY_FOR_PICKUP/PLACED/ACCEPTED), but partnerUpdateOrderStatus
  // reads its order/assignment snapshot once at request start with no
  // compare-and-swap on the eventual write, so a slow partner request that
  // read a pre-pickup status can still land its own release after a
  // dispatcher has already taken the same order to delivered. Both paths
  // calling the same loadReleasedAt-guarded function means only whichever
  // one actually flips it from null to non-null gets to decrement - the
  // other's call is a safe no-op, regardless of which one runs first.
  //
  // A failed delivery releases the same as a successful one: the rider is
  // no longer carrying this order either way, so their capacity should be
  // freed for a new assignment.
  //
  // Called with the order id alone, unconditionally on those two statuses
  // (review round 4): the assignment row - not this handler's snapshot -
  // decides which rider holds the claim, so a release landing just after a
  // manual reassignment now decrements the rider who actually has the order.
  // The old `if (releaseCourierId)` pre-check was the same stale read in
  // guard form: an order whose snapshot showed no courier may have been
  // claimed by automatic assignment in the meantime, and skipping the
  // release on that basis stranded the claim forever.
  const dispatchReleaseEligibleStatuses: readonly string[] = [ORDER_STATUS.DELIVERED, ORDER_STATUS.FAILED_DELIVERY];
  if (dispatchReleaseEligibleStatuses.includes(nextState.status)) {
    try {
      await releaseDispatchAssignmentLoad(orderId);
    } catch (error) {
      logEdgeEvent('error', 'dispatch load release failed', {
        error: error instanceof Error ? error.message : String(error),
        orderId,
        status: nextState.status,
      });
    }
  }

  await insertDeliveryEvent({
    orderId,
    eventType: `dispatch_${nextAction}`,
    actorUid: context.uid,
    details: {
      nextStatus: nextState.status,
    },
  });
  await notifyUsers([bundle.order.customerId], {
    title: 'Delivery update',
    body: `Order ${orderId.slice(-6).toUpperCase()} is now ${nextState.status.replace(/_/g, ' ')}.`,
    data: buildNotificationData({
      app: 'customer',
      orderId,
      routeKey: 'customer_order_detail',
      status: nextState.status,
      type: 'order_update',
    }),
  });
  await notifyRestaurantUsers(bundle.order.restaurantId, {
    title: 'Delivery progress update',
    body: `Order ${orderId.slice(-6).toUpperCase()} is now ${nextState.status.replace(/_/g, ' ')}.`,
    data: buildNotificationData({
      app: 'partner',
      orderId,
      routeKey: 'partner_order_detail',
      status: nextState.status,
      type: 'order_update',
    }),
  });

  return json(200, {
    data: {
      orderId,
      status: nextState.status,
    },
  });
};

const submitDispatchApplication: Handler = async ({ context, data }) => {
  const displayName = sanitizeText(data.displayName);
  const phoneNumber = sanitizeText(data.phoneNumber);
  const region = sanitizeText(data.region);
  const lga = sanitizeText(data.lga);
  const vehicleType = sanitizeText(data.vehicleType);
  const vehicleMake = sanitizeOptionalText(data.vehicleMake);
  const vehicleModel = sanitizeOptionalText(data.vehicleModel);
  const vehiclePlateNumber = sanitizeOptionalText(data.vehiclePlateNumber);
  const licenseNumber = sanitizeOptionalText(data.licenseNumber);
  const currentAddress = sanitizeOptionalText(data.currentAddress);
  const licenceFrontBase64 = sanitizeText(data.licenceFrontBase64);
  const licenceBackBase64 = sanitizeText(data.licenceBackBase64);
  const licenceFrontMimeType = sanitizeOptionalText(data.licenceFrontMimeType) ?? 'image/jpeg';
  const licenceBackMimeType = sanitizeOptionalText(data.licenceBackMimeType) ?? 'image/jpeg';
  const policyAcceptance = validatePolicyAcceptancePayload(
    data.policyAcceptance,
    'dispatch',
    'dispatch_signup'
  );

  if (!displayName) {
    fail(400, 'A rider name is required.');
  }
  if (!phoneNumber) {
    fail(400, 'A phone number is required.');
  }
  if (!region) {
    fail(400, 'Select a dispatch state before submitting.');
  }
  if (!lga) {
    fail(400, 'Select a dispatch LGA before submitting.');
  }
  if (!vehicleType) {
    fail(400, 'Select a delivery vehicle before submitting.');
  }
  if (!vehicleMake) {
    fail(400, 'Add the vehicle make before submitting.');
  }
  if (!vehicleModel) {
    fail(400, 'Add the vehicle model before submitting.');
  }
  if (!vehiclePlateNumber) {
    fail(400, 'Add the vehicle plate number before submitting.');
  }
  if (!licenseNumber) {
    fail(400, 'Add the licence number before submitting.');
  }
  if (!licenceFrontBase64 || !licenceBackBase64) {
    fail(400, 'Upload both sides of your licence before submitting.');
  }

  const existingApplication = await loadDispatchApplication(context.uid);
  const currentStatus = sanitizeText(existingApplication?.status, DISPATCH_APPLICATION_STATUS.PENDING);
  if (existingApplication && currentStatus === DISPATCH_APPLICATION_STATUS.APPROVED) {
    fail(
      412,
      'This dispatch application has already been approved. Sign in from the dispatch login screen.'
    );
  }

  const coordinates = getNigeriaAreaCoordinate(region);
  const submittedAt = existingApplication?.submittedAt ?? nowIso();
  const updatedAt = nowIso();
  const currentAccount = await loadUserAccount(context.uid);
  const licenceFrontPath = await uploadDispatchDocument({
    base64: licenceFrontBase64,
    courierId: context.uid,
    kind: 'licence_front',
    mimeType: licenceFrontMimeType,
  });
  const licenceBackPath = await uploadDispatchDocument({
    base64: licenceBackBase64,
    courierId: context.uid,
    kind: 'licence_back',
    mimeType: licenceBackMimeType,
  });

  const { error: applicationError } = await serviceClient.from('DispatchApplicationRecord').upsert(
    {
      id: context.uid,
      uid: context.uid,
      email: context.email,
      displayName,
      phoneNumber,
      region,
      lga,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehiclePlateNumber,
      licenseNumber,
      licenceFrontPath,
      licenceBackPath,
      currentAddress,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      status: DISPATCH_APPLICATION_STATUS.PENDING,
      verificationStatus: DISPATCH_APPLICATION_STATUS.PENDING,
      submittedAt,
      reviewedAt: null,
      verifiedAt: null,
      verifiedByUid: null,
      rejectionReason: null,
      reviewNotes: null,
      approvedByUid: null,
      updatedAt,
    },
    { onConflict: 'id' }
  );

  if (applicationError) {
    throw new Error(applicationError.message);
  }

  await upsertUserAccount({
    uid: context.uid,
    email: context.email,
    displayName,
    phoneNumber,
    emailVerified: true,
    roleDisplay: 'customer',
    dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.PENDING,
    dispatchApplicationReviewedAt: null,
    dispatchApplicationRejectionReason: null,
    createdAt: currentAccount?.createdAt ?? updatedAt,
    updatedAt,
  });
  await recordPolicyAcceptance(context.uid, context.email, policyAcceptance);
  await createAuditEntry(context.uid, 'dispatch_application_submitted', 'dispatch_application', context.uid, {
    lga,
    region,
    vehicleType,
  });
  await notifyAdmins({
    title: 'New dispatch application',
    body: `${displayName} submitted a courier application in ${region}.`,
    data: buildNotificationData({
      app: 'admin',
      extra: {
        applicationId: context.uid,
      },
      routeKey: 'admin_approvals',
      type: 'application_submitted',
    }),
  });

  return json(200, {
    data: {
      status: DISPATCH_APPLICATION_STATUS.PENDING,
      submittedAt,
      targetUid: context.uid,
    },
  });
};

// ---------------------------------------------------------------------------
// Offer response (Task 10 / D2).
//
// Both handlers are deliberately THIN. Every guard that matters - is this
// offer still live, is it yours, has the order gone terminal, has somebody
// else already won it, does a claim land - is inside the SQL function, under
// the CustomerOrder row lock. Task 9's four review rounds all found the same
// shape of bug: a check performed in TypeScript against a snapshot, with a
// write underneath it that was not conditioned on the same fact. So there is
// no pre-flight loadOrderBundle here, and no "is it still pending" read
// before the call. Adding one would not make the handler safer; it would
// only add a second, staler opinion about state the SQL is about to
// re-evaluate under a lock.
//
// In particular NOTE THE ABSENCE of assertNonTerminalOrder /
// assertOrderPaymentReadyForOperations calls. That is not a weakening of
// those gates - ebuy_accept_dispatch_offer enforces the terminal check via
// ebuy_claim_dispatch_assignment's own locked status guard, which is strictly
// stronger than the snapshot-based assert (it cannot be raced). The asserts
// remain untouched on every path that already used them.
// ---------------------------------------------------------------------------

/**
 * Maps a SQL refusal reason onto an HTTP status and a client-safe message.
 * The raw reason is never surfaced verbatim beyond these known values, and
 * an unrecognised one degrades to a generic 409 rather than leaking whatever
 * the database said.
 */
const failOfferResponse = (reason: string, action: 'accept' | 'decline'): never => {
  switch (reason) {
    case 'offer_not_found':
      // Also the answer for another rider's offer id: "not yours" and "does
      // not exist" are deliberately indistinguishable so the handler cannot
      // be used to probe for offer ids.
      fail(404, 'This delivery offer is no longer available.');
      break;
    case 'offer_expired':
      fail(410, 'This offer expired. It has been passed to another rider.');
      break;
    case 'offer_accepted':
      fail(409, 'This offer has already been accepted.');
      break;
    case 'offer_declined':
      fail(409, 'You have already declined this offer.');
      break;
    case 'offer_superseded':
      fail(409, 'This offer was passed to another rider.');
      break;
    case 'claim_refused':
      fail(409, 'Another rider took this delivery first.');
      break;
    default:
      fail(
        409,
        action === 'accept'
          ? 'This delivery offer could not be accepted.'
          : 'This delivery offer could not be declined.'
      );
  }

  // `fail` is typed to return never, but TypeScript does not carry that
  // through a switch with a default, so this is unreachable belt-and-braces.
  throw new Error('unreachable');
};

const dispatchAcceptOffer: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch']);

  const offerId = sanitizeText(data.offerId);
  if (!offerId) {
    fail(400, 'Offer id is required.');
  }

  // The rider record supplies the display name stamped onto the assignment.
  // Looked up rather than taken from the request so a client cannot choose
  // the name that will appear on somebody else's order.
  const { data: rider, error: riderError } = await serviceClient
    .from('DispatchRiderRecord')
    .select(DISPATCH_RIDER_COLUMNS)
    .eq('id', context.uid)
    .maybeSingle<DispatchRiderRow>();

  if (riderError) {
    throw new Error(riderError.message);
  }

  const courierName = sanitizeText(rider?.displayName, `Rider ${context.uid.slice(-4)}`);

  // The single point at which activeLoad is incremented in the offer model.
  // acceptDispatchOffer -> ebuy_accept_dispatch_offer ->
  // ebuy_claim_dispatch_assignment (Task 9, unmodified).
  const result = await acceptDispatchOffer(offerId, context.uid, courierName);

  if (!result.ok) {
    logEdgeEvent('info', 'dispatch offer accept refused', {
      action: 'dispatchAcceptOffer',
      offerId,
      orderId: result.orderId,
      reason: result.reason,
      uid: context.uid,
    });
    failOfferResponse(result.reason, 'accept');
  }

  const orderId = sanitizeText(result.orderId);

  await insertDeliveryEvent({
    actorUid: context.uid,
    details: {
      courierId: context.uid,
      courierName,
      offerId,
    },
    eventType: 'dispatch_offer_accepted',
    orderId,
  });

  await broadcastOrderChanged(orderId);

  return json(200, {
    data: {
      accepted: true,
      offerId,
      orderId,
    },
  });
};

const dispatchDeclineOffer: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch']);

  const offerId = sanitizeText(data.offerId);
  if (!offerId) {
    fail(400, 'Offer id is required.');
  }

  // Touches no counter: a decline was never a claim, so there is nothing to
  // release. This is the whole reason the claim was moved to accept.
  const result = await declineDispatchOffer(offerId, context.uid);

  if (!result.ok) {
    logEdgeEvent('info', 'dispatch offer decline refused', {
      action: 'dispatchDeclineOffer',
      offerId,
      orderId: result.orderId,
      reason: result.reason,
      uid: context.uid,
    });
    failOfferResponse(result.reason, 'decline');
  }

  const orderId = sanitizeText(result.orderId);

  await insertDeliveryEvent({
    actorUid: context.uid,
    details: {
      courierId: context.uid,
      offerId,
    },
    eventType: 'dispatch_offer_declined',
    orderId,
  });

  // Re-offer immediately to the next-best courier, excluding everyone who has
  // already seen this order (the decliner is now in that set). Non-fatal and
  // logged, never re-thrown: the decline itself has already committed, and
  // the rider's action must not fail because the re-offer did. If this throws
  // or finds nobody right now, the queue-drainer sweep picks the order up on
  // its next pass - ebuy_list_dispatch_reoffer_candidates finds it precisely
  // because it has offers, no pending one, and no courier.
  try {
    await reofferDispatchOrder(orderId, context.uid, loadDispatchWeights);
  } catch (error) {
    logEdgeEvent('error', 'dispatch re-offer after decline failed', {
      action: 'dispatchDeclineOffer',
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
  }

  await broadcastOrderChanged(orderId);

  return json(200, {
    data: {
      declined: true,
      offerId,
      orderId,
    },
  });
};

export const dispatchDomain = defineRpcDomain<AuthenticatedRequestContext>({
  actions: DISPATCH_ACTIONS,
  name: 'dispatch',
  handlers: {
    dispatchAcceptOffer,
    dispatchAssignOrderCourier,
    dispatchDeclineOffer,
    dispatchGetDeliveryQueue,
    dispatchGetOrderDetail,
    dispatchGetRiders,
    dispatchGetWeeklyEarnings,
    dispatchGetShiftSlots,
    dispatchUpdateOrderStatus,
    submitDispatchApplication,
    syncDispatchRiderLocation,
    dispatchUpsertShiftSlots,
    upsertDispatchRiderProfile,
  },
});
