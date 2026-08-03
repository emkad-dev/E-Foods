// Dispatch domain: the dispatcher's delivery queue, rider records and
// locations, courier assignment, delivery status transitions, weekly earnings,
// and the rider onboarding application.

import { loadUserAccount, loadUserPhoneNumber, syncUserRoleState, upsertUserAccount } from '../accounts.ts';
import { DISPATCH_APPLICATION_STATUS, loadDispatchApplication } from '../applications.ts';
import { createAuditEntry } from '../auditLog.ts';
import { serviceClient } from '../client.ts';
import {
  DEFAULT_DISPATCH_STATUS,
  DEFAULT_DISPATCH_VEHICLE,
  DISPATCH_RIDER_COLUMNS,
  adjustDispatchRiderLoad,
  buildDispatchRiderResponse,
  ensureDispatchRiderRecord,
  type DispatchRiderRow,
} from '../dispatchRiders.ts';
import { getNigeriaAreaCoordinate } from '../nigeriaGeography.ts';
import { buildNotificationData, notifyAdmins, notifyRestaurantUsers, notifyUsers } from '../notifications.ts';
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
import { recordPolicyAcceptance, validatePolicyAcceptancePayload } from '../policyAcceptance.ts';
import { broadcastRidersChanged } from '../realtime.ts';
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

const getDispatchEarningsAmount = (pricing: JsonObject | null | undefined) =>
  roundCurrency(parseNumber(pricing?.dispatchFee, parseNumber(pricing?.deliveryFee, 0)));

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
  const scopedOrderList =
    context.role === 'admin'
      ? sortedOrderList
      : sortedOrderList.filter(
          (order) => getDispatchAssignmentOwnerId(assignmentsByOrderId.get(order.id) ?? null) === context.uid
        );

  return json(200, {
    data: {
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

  const { data: assignments, error: assignmentError } = await serviceClient
    .from('DeliveryAssignment')
    .select('orderId,courierId,courierName,assignedAt')
    .eq('courierId', courierId);

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  const orderIds = ((assignments ?? []) as DeliveryAssignmentRow[])
    .map((assignment) => sanitizeText(assignment.orderId))
    .filter(Boolean);

  if (orderIds.length === 0) {
    return json(200, {
      data: {
        averagePerDelivery: 0,
        currency: DEFAULT_CURRENCY,
        deliveredOrders: 0,
        records: [],
        total: 0,
        week: weekWindow,
      },
    });
  }

  const { data: orders, error: orderError } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .in('id', orderIds)
    .eq('status', ORDER_STATUS.DELIVERED)
    .order('updatedAt', { ascending: false });

  if (orderError) {
    throw new Error(orderError.message);
  }

  const deliveredOrders = ((orders ?? []) as CustomerOrderRow[]).filter(
    (order) =>
      normalizeOrderStatus(order.status) === ORDER_STATUS.DELIVERED &&
      isIsoDateInWindow(getOrderDeliveredAt(order), weekWindow.startsAt, weekWindow.endsAt)
  );
  const records = deliveredOrders.map((order) => {
    const earningsAmount = getDispatchEarningsAmount(order.pricing);
    const deliveredAt = getOrderDeliveredAt(order);

    return {
      address: sanitizeOptionalText(order.deliveryLocation?.shortAddress) ??
        sanitizeOptionalText(order.deliveryAddress),
      amount: earningsAmount,
      deliveredAt,
      orderId: order.id,
      restaurantName: order.restaurantName,
    };
  }).sort((left, right) => Date.parse(right.deliveredAt ?? '') - Date.parse(left.deliveredAt ?? ''));
  const total = roundCurrency(records.reduce((sum, record) => sum + record.amount, 0));
  const deliveredOrderCount = records.length;

  return json(200, {
    data: {
      averagePerDelivery: deliveredOrderCount > 0 ? roundCurrency(total / deliveredOrderCount) : 0,
      currency: DEFAULT_CURRENCY,
      deliveredOrders: deliveredOrderCount,
      records,
      total,
      week: weekWindow,
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
    fail(403, 'This delivery is not assigned to your dispatcher queue.');
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

  return json(200, {
    data: {
      accuracy: parseNumber(data.accuracy, null),
      latitude,
      longitude,
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
  if (context.role !== 'admin' && dispatchOwnerId !== context.uid) {
    fail(403, 'This delivery is not assigned to your dispatcher queue.');
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
  const previousCourierId = sanitizeText(bundle.assignment?.courierId);
  const wasReassigned = Boolean(
    previousCourierId && previousCourierId !== courier.id
  );

  const { error: assignmentError } = await serviceClient.from('DeliveryAssignment').upsert(
    {
      assignedAt,
      courierId: courier.id,
      courierName,
      dispatchId: context.uid,
      dispatchOwnerId: dispatchOwnerId ?? null,
      orderId,
      updatedAt: assignedAt,
    },
    { onConflict: 'orderId' }
  );

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  if (previousCourierId && previousCourierId !== courier.id) {
    await adjustDispatchRiderLoad(previousCourierId, -1);
  }
  if (!previousCourierId || previousCourierId !== courier.id) {
    await adjustDispatchRiderLoad(courier.id, 1);
  }

  await updateOrderRecord(orderId, {
    updatedAt: assignedAt,
  });

  await insertDeliveryEvent({
    orderId,
    eventType: wasReassigned ? 'courier_reassigned' : 'courier_assigned',
    actorUid: context.uid,
    details: {
      courierId: courier.id,
      courierName,
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
    fail(403, 'This delivery is not assigned to your dispatcher queue.');
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

  if ([ORDER_STATUS.DELIVERED, ORDER_STATUS.FAILED_DELIVERY].includes(nextState.status)) {
    await adjustDispatchRiderLoad(bundle.assignment?.courierId, -1);
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
  const currentAddress = sanitizeOptionalText(data.currentAddress);
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
      currentAddress,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      status: DISPATCH_APPLICATION_STATUS.APPROVED,
      submittedAt,
      reviewedAt: updatedAt,
      approvedByUid: context.uid,
      rejectionReason: null,
      updatedAt,
    },
    { onConflict: 'id' }
  );

  if (applicationError) {
    throw new Error(applicationError.message);
  }

  await syncUserRoleState(context.uid, 'dispatch', null, {
    accountDisabled: false,
    disabledAt: null,
    disabledByUid: null,
    lastPrivilegedRole: 'dispatch',
  });
  await ensureDispatchRiderRecord(context.uid, {
    acceptanceRate: 100,
    activeLoad: 0,
    completedTrips: 0,
    currentAddress,
    displayName,
    lga,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    phoneNumber,
    region,
    status: DEFAULT_DISPATCH_STATUS,
    vehicleType,
    zone: region,
  });
  await upsertUserAccount({
    uid: context.uid,
    email: context.email,
    displayName,
    phoneNumber,
    emailVerified: true,
    roleDisplay: 'dispatch',
    dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.APPROVED,
    dispatchApplicationReviewedAt: updatedAt,
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
    title: 'New dispatch rider',
    body: `${displayName} is now live for dispatch access in ${region}.`,
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
      status: DISPATCH_APPLICATION_STATUS.APPROVED,
      submittedAt,
      targetUid: context.uid,
    },
  });
};

export const dispatchDomain = defineRpcDomain<AuthenticatedRequestContext>({
  actions: DISPATCH_ACTIONS,
  name: 'dispatch',
  handlers: {
    dispatchAssignOrderCourier,
    dispatchGetDeliveryQueue,
    dispatchGetOrderDetail,
    dispatchGetRiders,
    dispatchGetWeeklyEarnings,
    dispatchUpdateOrderStatus,
    submitDispatchApplication,
    syncDispatchRiderLocation,
    upsertDispatchRiderProfile,
  },
});
