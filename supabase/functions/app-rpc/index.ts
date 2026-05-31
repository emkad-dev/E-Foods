/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { verifySupabaseJwt } from '../_shared/auth.ts';
import { serviceClient } from '../_shared/client.ts';
import {
  buildNotificationData,
  loadRestaurantRecipientUserIds,
  sendPushNotificationsToRoles,
  sendPushNotificationsToUsers,
} from '../_shared/notifications.ts';
import { getAuthenticatedRequestContext } from '../_shared/request-context.ts';

type JsonObject = Record<string, unknown>;

type UserAccountRow = {
  accountDisabled?: boolean | null;
  activeSessionId?: string | null;
  activeSessionUpdatedAt?: string | null;
  createdAt?: string | null;
  disabledAt?: string | null;
  disabledByUid?: string | null;
  displayName?: string | null;
  email: string;
  emailVerified?: boolean | null;
  lastPrivilegedRole?: string | null;
  partnerApplicationRejectionReason?: string | null;
  partnerApplicationReviewedAt?: string | null;
  partnerApplicationStatus?: string | null;
  dispatchApplicationRejectionReason?: string | null;
  dispatchApplicationReviewedAt?: string | null;
  dispatchApplicationStatus?: string | null;
  phoneNumber?: string | null;
  restaurantId?: string | null;
  restaurantLinkedAt?: string | null;
  restaurantLinkSource?: string | null;
  restaurantName?: string | null;
  roleDisplay?: string | null;
  uid: string;
  updatedAt?: string | null;
};

type UserRoleRow = {
  assignedByUid?: string | null;
  restaurantId?: string | null;
  role: string;
  userId: string;
};

type RestaurantApprovalRow = {
  approvedAt?: string | null;
  approvedByUid?: string | null;
  restaurantId: string;
  status: string;
};

type RestaurantRecordRow = {
  address?: string | null;
  closingTime?: string | null;
  createdAt?: string | null;
  cuisine?: string | null;
  deliveryFee?: number | null;
  deliveryRadiusKm?: number | null;
  deliveryTime?: string | null;
  description?: string | null;
  id: string;
  image?: string | null;
  logoImage?: string | null;
  isOpen?: boolean | null;
  isPublished?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  menu?: unknown[] | null;
  minOrder?: number | null;
  name: string;
  nameKey?: string | null;
  openingTime?: string | null;
  ownerId?: string | null;
  paystackSubaccountCode?: string | null;
  supportsDelivery?: boolean | null;
  supportsPickup?: boolean | null;
  updatedAt?: string | null;
};

type CustomerOrderRow = {
  cancellation?: JsonObject | null;
  createdAt?: string | null;
  customerId: string;
  deliveryAddress?: string | null;
  deliveryLocation?: JsonObject | null;
  fulfillmentType?: string | null;
  id: string;
  payment?: JsonObject | null;
  pricing?: JsonObject | null;
  restaurantId: string;
  restaurantName: string;
  status?: string | null;
  timeline?: JsonObject | null;
  updatedAt?: string | null;
};

type DeliveryAssignmentRow = {
  assignedAt?: string | null;
  courierId?: string | null;
  courierName?: string | null;
  dispatchId?: string | null;
  orderId: string;
};

type DeliveryEventRow = {
  actorUid?: string | null;
  createdAt?: string | null;
  details?: JsonObject | null;
  eventType: string;
  id: string;
  note?: string | null;
  orderId: string;
};

type DispatchRiderRow = {
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

type PartnerApplicationRow = {
  address: string;
  approvedByUid?: string | null;
  contactName: string;
  cuisine: string;
  deliveryTime?: string | null;
  description?: string | null;
  email: string;
  id: string;
  logoImage?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phoneNumber: string;
  rejectionReason?: string | null;
  restaurantId?: string | null;
  restaurantName: string;
  reviewedAt?: string | null;
  status: string;
  submittedAt: string;
  uid: string;
  updatedAt?: string | null;
};

type DispatchApplicationRow = {
  approvedByUid?: string | null;
  currentAddress?: string | null;
  displayName: string;
  email: string;
  id: string;
  latitude?: number | null;
  lga: string;
  longitude?: number | null;
  phoneNumber: string;
  region: string;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  status: string;
  submittedAt: string;
  uid: string;
  updatedAt?: string | null;
  vehicleType: string;
};

type IdempotencyRecordRow = {
  actorUid?: string | null;
  key: string;
  response?: JsonObject | null;
  scope: string;
};

type OrderItemRow = {
  itemId: string;
  name: string;
  orderId: string;
  price: number;
  quantity: number;
  restaurantId: string;
  restaurantName: string;
};

type PaymentTransactionRow = {
  accessCode?: string | null;
  authorizationUrl?: string | null;
  channel?: string | null;
  customerId: string;
  gatewayStatus?: string | null;
  lastError?: string | null;
  method: string;
  orderId: string;
  reference: string;
  restaurantId: string;
  splitSubaccountCode?: string | null;
  status: string;
};

type DispatchOrderDetailResponse = ReturnType<typeof toOrderSnapshotResponse>;

type OrderSnapshotOptions = {
  courierPhone?: string | null;
  customerPhone?: string | null;
};

const APP_ROLES = ['customer', 'restaurant', 'dispatch', 'admin'] as const;
const PRIVILEGED_APP_ROLES = new Set(['restaurant', 'dispatch', 'admin']);
const DISPATCH_APPLICATION_STATUS = {
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
} as const;
const PARTNER_APPLICATION_STATUS = {
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
} as const;
const TERMINAL_ORDER_STATUSES = new Set(['delivered', 'cancelled', 'rejected', 'failed_delivery']);
const PREPAID_PAYMENT_METHODS = new Set(['card', 'wallet', 'bank_transfer']);
const PAYSTACK_PAYMENT_METHODS = new Set(['card', 'bank_transfer']);
const DEFAULT_FUNCTION_ORDER_STATUS = 'placed';
const DEFAULT_CURRENCY = 'NGN';
const DEFAULT_DELIVERY_TIME = '25-35 min';
const DEFAULT_DISPATCH_STATUS = 'Available';
const DEFAULT_DISPATCH_VEHICLE = 'Bike';
const PLATFORM_COMMISSION_RATE = 0.15;
const PAYMENT_PROVIDER_PAYSTACK = 'paystack';
const PAYMENT_PROVIDER_CASH = 'cash_on_delivery';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
const PAYMENT_STATUS = {
  AUTHORIZED: 'authorized',
  FAILED: 'failed',
  PAID: 'paid',
  PENDING: 'pending',
  REFUNDED: 'refunded',
} as const;
const DEFAULT_NIGERIA_COORDINATE = { latitude: 9.0765, longitude: 7.3986 };
const NIGERIA_STATE_CENTERS: Record<string, { latitude: number; longitude: number }> = {
  Abia: { latitude: 5.532, longitude: 7.486 },
  Adamawa: { latitude: 9.326, longitude: 12.398 },
  'Akwa Ibom': { latitude: 5.037, longitude: 7.912 },
  Anambra: { latitude: 6.21, longitude: 7.067 },
  Bauchi: { latitude: 10.315, longitude: 9.844 },
  Bayelsa: { latitude: 4.926, longitude: 6.267 },
  Benue: { latitude: 7.731, longitude: 8.539 },
  Borno: { latitude: 11.833, longitude: 13.151 },
  'Cross River': { latitude: 4.958, longitude: 8.326 },
  Delta: { latitude: 5.704, longitude: 5.934 },
  Ebonyi: { latitude: 6.265, longitude: 8.013 },
  Edo: { latitude: 6.338, longitude: 5.625 },
  Ekiti: { latitude: 7.719, longitude: 5.311 },
  Enugu: { latitude: 6.458, longitude: 7.546 },
  'Federal Capital Territory': { latitude: 9.0765, longitude: 7.3986 },
  Gombe: { latitude: 10.29, longitude: 11.17 },
  Imo: { latitude: 5.484, longitude: 7.035 },
  Jigawa: { latitude: 12.228, longitude: 9.562 },
  Kaduna: { latitude: 10.511, longitude: 7.438 },
  Kano: { latitude: 12.002, longitude: 8.592 },
  Katsina: { latitude: 12.985, longitude: 7.617 },
  Kebbi: { latitude: 12.451, longitude: 4.197 },
  Kogi: { latitude: 7.801, longitude: 6.739 },
  Kwara: { latitude: 8.496, longitude: 4.542 },
  Lagos: { latitude: 6.5244, longitude: 3.3792 },
  Nasarawa: { latitude: 8.537, longitude: 8.322 },
  Niger: { latitude: 9.93, longitude: 5.598 },
  Ogun: { latitude: 7.161, longitude: 3.35 },
  Ondo: { latitude: 7.252, longitude: 5.193 },
  Osun: { latitude: 7.771, longitude: 4.556 },
  Oyo: { latitude: 7.378, longitude: 3.947 },
  Plateau: { latitude: 9.8965, longitude: 8.8583 },
  Rivers: { latitude: 4.8156, longitude: 7.0498 },
  Sokoto: { latitude: 13.06, longitude: 5.237 },
  Taraba: { latitude: 7.999, longitude: 10.774 },
  Yobe: { latitude: 11.747, longitude: 11.966 },
  Zamfara: { latitude: 12.17, longitude: 6.664 },
};
const ORDER_STATUS = {
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
  DELIVERED: 'delivered',
  ESCALATED: 'escalated',
  FAILED_DELIVERY: 'failed_delivery',
  ON_THE_WAY: 'on_the_way',
  PICKED_UP: 'picked_up',
  PLACED: 'placed',
  PREPARING: 'preparing',
  READY_FOR_PICKUP: 'ready_for_pickup',
  REJECTED: 'rejected',
} as const;

const toSortableTimestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

class RpcError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
  }
}

const fail = (status: number, message: string): never => {
  throw new RpcError(status, message);
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  });

const nowIso = () => new Date().toISOString();

const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const sanitizeOptionalText = (value: unknown) => {
  const nextValue = sanitizeText(value);
  return nextValue || null;
};

const normalizeOperatingTime = (value: unknown, fieldLabel: string) => {
  const nextValue = sanitizeOptionalText(value);
  if (!nextValue) {
    return null;
  }

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(nextValue)) {
    fail(400, `${fieldLabel} must use 24-hour HH:mm format.`);
  }

  return nextValue;
};

const parseNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const parseInteger = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const buildNameKey = (value: string) =>
  sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeOrderStatus = (value: unknown) => {
  const status = sanitizeText(value, 'draft');
  switch (status) {
    case 'pending':
      return ORDER_STATUS.PLACED;
    case 'ready':
      return ORDER_STATUS.READY_FOR_PICKUP;
    default:
      return status;
  }
};

const getPartnerKitchenPriority = (order: CustomerOrderRow) => {
  const status = normalizeOrderStatus(order.status);

  if (status === ORDER_STATUS.PLACED) {
    return 0;
  }

  if (status === ORDER_STATUS.ACCEPTED) {
    return 1;
  }

  if (status === ORDER_STATUS.PREPARING) {
    return 2;
  }

  if (status === ORDER_STATUS.READY_FOR_PICKUP) {
    return 3;
  }

  if ([ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY].includes(status)) {
    return 4;
  }

  return 5;
};

const sortPartnerKitchenQueue = (orders: CustomerOrderRow[]) =>
  [...orders].sort((left, right) => {
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

    const priorityDelta = getPartnerKitchenPriority(left) - getPartnerKitchenPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return toSortableTimestamp(left.createdAt) - toSortableTimestamp(right.createdAt);
  });

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

const isAppRole = (role: string) => (APP_ROLES as readonly string[]).includes(role);

const ensureRole = (role: string, allowedRoles: readonly string[]) => {
  if (!allowedRoles.includes(role)) {
    fail(403, 'You do not have permission to perform this action.');
  }
};

const toOrderSnapshotResponse = (
  order: CustomerOrderRow,
  items: OrderItemRow[],
  assignment: DeliveryAssignmentRow | null,
  events: DeliveryEventRow[] = [],
  options: OrderSnapshotOptions = {}
) => ({
  assignment: assignment
    ? {
        courierId: sanitizeOptionalText(assignment.courierId),
        courierName: sanitizeOptionalText(assignment.courierName),
        courierPhone: sanitizeOptionalText(options.courierPhone),
        dispatchId: sanitizeOptionalText(assignment.dispatchId),
      }
    : null,
  cancellation: order.cancellation ?? null,
  createdAt: order.createdAt ?? null,
  customerId: order.customerId,
  customerPhone: sanitizeOptionalText(options.customerPhone),
  deliveryAddress: sanitizeOptionalText(order.deliveryAddress),
  deliveryLocation: order.deliveryLocation ?? null,
  events: events.map((event) => ({
    actorUid: sanitizeOptionalText(event.actorUid),
    createdAt: event.createdAt ?? null,
    details: event.details ?? null,
    eventType: event.eventType,
    id: event.id,
    note: sanitizeOptionalText(event.note),
  })),
  fulfillmentType: sanitizeText(order.fulfillmentType, 'delivery'),
  id: order.id,
  items: items.map((item) => ({
    id: item.itemId,
    name: item.name,
    price: Number(item.price ?? 0),
    quantity: Number(item.quantity ?? 0),
    restaurantId: item.restaurantId,
    restaurantName: item.restaurantName,
  })),
  payment: order.payment ?? null,
  pricing: order.pricing ?? null,
  restaurantId: order.restaurantId,
  restaurantName: order.restaurantName,
  status: sanitizeText(order.status, DEFAULT_FUNCTION_ORDER_STATUS),
  timeline: order.timeline ?? null,
  total: Number((order.pricing as JsonObject | null)?.total ?? 0),
  updatedAt: order.updatedAt ?? null,
});

const buildRestaurantResponse = (
  restaurant: RestaurantRecordRow,
  approval: RestaurantApprovalRow | null = null
) => ({
  address: sanitizeOptionalText(restaurant.address),
  approvalStatus: approval?.status ?? (restaurant.isPublished ? 'approved' : 'pending'),
  approvedAt: approval?.approvedAt ?? null,
  approvedByUid: sanitizeOptionalText(approval?.approvedByUid),
  cuisine: sanitizeOptionalText(restaurant.cuisine),
  deliveryFee: restaurant.deliveryFee ?? 0,
  deliveryRadiusKm: restaurant.deliveryRadiusKm ?? null,
  deliveryTime: sanitizeOptionalText(restaurant.deliveryTime),
  closingTime: sanitizeOptionalText(restaurant.closingTime),
  description: sanitizeOptionalText(restaurant.description),
  id: restaurant.id,
  image: sanitizeOptionalText(restaurant.image),
  logoImage: sanitizeOptionalText(restaurant.logoImage),
  isOpen: restaurant.isOpen !== false,
  isPublished: restaurant.isPublished === true,
  latitude: restaurant.latitude ?? null,
  longitude: restaurant.longitude ?? null,
  menu: Array.isArray(restaurant.menu) ? restaurant.menu : [],
  minOrder: restaurant.minOrder ?? 0,
  name: sanitizeText(restaurant.name, 'Restaurant'),
  openingTime: sanitizeOptionalText(restaurant.openingTime),
  ownerId: sanitizeOptionalText(restaurant.ownerId),
  paystackSubaccountCode: sanitizeOptionalText(restaurant.paystackSubaccountCode),
  supportsDelivery: restaurant.supportsDelivery !== false,
  supportsPickup: restaurant.supportsPickup !== false,
  updatedAt: restaurant.updatedAt ?? null,
});

const buildDispatchRiderResponse = (rider: DispatchRiderRow) => ({
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

const getRolePriority = (role: string) => {
  switch (role) {
    case 'admin':
      return 1;
    case 'restaurant':
      return 2;
    case 'dispatch':
      return 3;
    default:
      return 4;
  }
};

const resolvePrimaryRole = (account: UserAccountRow | null, roles: UserRoleRow[]) => {
  const nextRole = [...roles].sort((left, right) => getRolePriority(left.role) - getRolePriority(right.role))[0]?.role;
  return sanitizeText(nextRole, sanitizeText(account?.roleDisplay, 'customer'));
};

const buildUserAccountResponse = (account: UserAccountRow, roles: UserRoleRow[]) => ({
  activeSessionId: sanitizeOptionalText(account.activeSessionId),
  activeSessionUpdatedAt: account.activeSessionUpdatedAt ?? null,
  accountDisabled: account.accountDisabled === true,
  createdAt: account.createdAt ?? null,
  displayName: sanitizeOptionalText(account.displayName),
  disabledAt: account.disabledAt ?? null,
  disabledByUid: sanitizeOptionalText(account.disabledByUid),
  email: sanitizeText(account.email),
  emailVerified: account.emailVerified === true,
  lastPrivilegedRole: sanitizeOptionalText(account.lastPrivilegedRole),
  restaurantId: sanitizeOptionalText(account.restaurantId),
  restaurantLinkedAt: account.restaurantLinkedAt ?? null,
  restaurantLinkSource: sanitizeOptionalText(account.restaurantLinkSource),
  restaurantName: sanitizeOptionalText(account.restaurantName),
  role: resolvePrimaryRole(account, roles),
  uid: account.uid,
  updatedAt: account.updatedAt ?? null,
});

const buildPartnerApplicationResponse = (application: PartnerApplicationRow) => ({
  address: sanitizeText(application.address),
  approvedByUid: sanitizeOptionalText(application.approvedByUid),
  contactName: sanitizeText(application.contactName),
  cuisine: sanitizeText(application.cuisine),
  deliveryTime: sanitizeOptionalText(application.deliveryTime),
  description: sanitizeOptionalText(application.description),
  email: sanitizeText(application.email),
  id: application.id,
  logoImage: sanitizeOptionalText(application.logoImage),
  latitude: application.latitude ?? null,
  longitude: application.longitude ?? null,
  phoneNumber: sanitizeText(application.phoneNumber),
  rejectionReason: sanitizeOptionalText(application.rejectionReason),
  restaurantName: sanitizeText(application.restaurantName),
  reviewedAt: application.reviewedAt ?? null,
  status: sanitizeText(application.status, PARTNER_APPLICATION_STATUS.PENDING),
  submittedAt: application.submittedAt,
  uid: application.uid,
});

const buildDispatchApplicationResponse = (application: DispatchApplicationRow) => ({
  approvedByUid: sanitizeOptionalText(application.approvedByUid),
  currentAddress: sanitizeOptionalText(application.currentAddress),
  displayName: sanitizeText(application.displayName),
  email: sanitizeText(application.email),
  id: application.id,
  latitude: application.latitude ?? DEFAULT_NIGERIA_COORDINATE.latitude,
  lga: sanitizeText(application.lga),
  longitude: application.longitude ?? DEFAULT_NIGERIA_COORDINATE.longitude,
  phoneNumber: sanitizeText(application.phoneNumber),
  region: sanitizeText(application.region),
  rejectionReason: sanitizeOptionalText(application.rejectionReason),
  reviewedAt: application.reviewedAt ?? null,
  status: sanitizeText(application.status, DISPATCH_APPLICATION_STATUS.PENDING),
  submittedAt: application.submittedAt,
  uid: application.uid,
  vehicleType: sanitizeText(application.vehicleType, DEFAULT_DISPATCH_VEHICLE),
});

const notifySafely = async (work: () => Promise<void>) => {
  try {
    await work();
  } catch (error) {
    console.error('Notification dispatch failed.', error);
  }
};

const notifyUsers = async (
  userIds: string[],
  payload: {
    body: string;
    data?: JsonObject;
    title: string;
  }
) => {
  await notifySafely(async () => {
    await sendPushNotificationsToUsers(userIds, {
      body: payload.body,
      data: payload.data ?? {},
      title: payload.title,
    });
  });
};

const notifyAdmins = async (
  payload: {
    body: string;
    data?: JsonObject;
    title: string;
  }
) => {
  await notifySafely(async () => {
    await sendPushNotificationsToRoles(['admin'], {
      body: payload.body,
      data: payload.data ?? {},
      title: payload.title,
    });
  });
};

const notifyRestaurantUsers = async (
  restaurantId: string,
  payload: {
    body: string;
    data?: JsonObject;
    title: string;
  }
) => {
  await notifySafely(async () => {
    const userIds = await loadRestaurantRecipientUserIds(restaurantId);
    await sendPushNotificationsToUsers(userIds, {
      body: payload.body,
      data: payload.data ?? {},
      title: payload.title,
    });
  });
};

const createAuditEntry = async (
  actorUid: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  details: JsonObject | null = null
) => {
  const { error } = await serviceClient.from('AdminAuditLog').insert({
    actorUid,
    action,
    targetType,
    targetId,
    details,
  });

  if (error) {
    throw new Error(error.message);
  }
};

const assertSupabaseAdminConfigured = () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    fail(500, 'Supabase admin credentials are not configured for this Edge function.');
  }
};

const toSupabaseAdminHeaders = () => {
  assertSupabaseAdminConfigured();
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
};

const adminAuthRequest = async <T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  assertSupabaseAdminConfigured();
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: {
      ...toSupabaseAdminHeaders(),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as T & { message?: string; msg?: string } | null;

  if (!response.ok) {
    fail(500, payload?.message ?? payload?.msg ?? 'Supabase admin request failed.');
  }

  return (payload ?? {}) as T;
};

const listSupabaseAuthUsers = async () => {
  const users: Record<string, unknown>[] = [];
  let page = 1;

  while (true) {
    const payload = await adminAuthRequest<{ users?: Record<string, unknown>[] }>(
      `/auth/v1/admin/users?page=${page}&per_page=200`,
      { method: 'GET' }
    );
    const batch = Array.isArray(payload.users) ? payload.users : [];
    users.push(...batch);
    if (batch.length < 200) {
      break;
    }
    page += 1;
  }

  return users;
};

const findSupabaseAuthUserByEmail = async (email: string) => {
  const normalizedEmail = sanitizeText(email).toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const users = await listSupabaseAuthUsers();
  return (
    users.find(
      (user) =>
        typeof user.email === 'string' && sanitizeText(user.email).toLowerCase() === normalizedEmail
    ) ?? null
  );
};

const createSupabaseAuthUser = async (input: {
  displayName?: string | null;
  email: string;
  emailConfirmed?: boolean;
  password: string;
  role: string;
}) =>
  adminAuthRequest<Record<string, unknown> & { user?: Record<string, unknown> }>('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      app_metadata: {
        app_role: input.role,
        role: input.role,
        user_role: input.role,
      },
      email: input.email,
      email_confirm: input.emailConfirmed === true,
      password: input.password,
      user_metadata: input.displayName
        ? {
            full_name: input.displayName,
          }
        : undefined,
    }),
  }).then((payload) => payload.user ?? payload);

const updateSupabaseAuthUser = async (
  uid: string,
  updates: Record<string, unknown>
) =>
  adminAuthRequest<Record<string, unknown> & { user?: Record<string, unknown> }>(
    `/auth/v1/admin/users/${uid}`,
    {
      method: 'PUT',
      body: JSON.stringify(updates),
    }
  ).then((payload) => payload.user ?? payload);

const deleteSupabaseAuthUser = async (uid: string) => {
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: toSupabaseAdminHeaders(),
  });

  if (!response.ok && response.status !== 404) {
    const payload = (await response.json().catch(() => null)) as { message?: string; msg?: string } | null;
    fail(500, payload?.message ?? payload?.msg ?? 'Unable to delete the Supabase auth user.');
  }
};

const normalizeNigeriaStateName = (state: string) => {
  const normalized = sanitizeText(state);
  if (!normalized) {
    return null;
  }

  const nextValue = normalized.toLowerCase();
  if (nextValue === 'fct' || nextValue === 'abuja' || nextValue === 'fct-abuja') {
    return 'Federal Capital Territory';
  }

  if (nextValue === 'nassarawa') {
    return 'Nasarawa';
  }

  return (
    Object.keys(NIGERIA_STATE_CENTERS).find((candidate) => candidate.toLowerCase() === nextValue) ?? normalized
  );
};

const getNigeriaAreaCoordinate = (state: string) => {
  const normalizedState = normalizeNigeriaStateName(state);
  return (normalizedState && NIGERIA_STATE_CENTERS[normalizedState]) || DEFAULT_NIGERIA_COORDINATE;
};

const getBootstrapAdminEmails = () =>
  (Deno.env.get('BOOTSTRAP_ADMIN_EMAILS') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

const getIdempotencyRecord = async (key: string) => {
  const { data, error } = await serviceClient
    .from('IdempotencyRecord')
    .select('key,scope,actorUid,response')
    .eq('key', key)
    .maybeSingle<IdempotencyRecordRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

const storeIdempotencyRecord = async (
  key: string,
  scope: string,
  actorUid: string,
  response: JsonObject | null
) => {
  const { error } = await serviceClient.from('IdempotencyRecord').upsert(
    {
      key,
      scope,
      actorUid,
      response,
      updatedAt: nowIso(),
    },
    { onConflict: 'key' }
  );

  if (error) {
    throw new Error(error.message);
  }
};

const loadUserAccount = async (uid: string) => {
  const { data, error } = await serviceClient
    .from('UserAccount')
    .select(
      'uid,email,displayName,phoneNumber,emailVerified,roleDisplay,partnerApplicationStatus,partnerApplicationReviewedAt,partnerApplicationRejectionReason,dispatchApplicationStatus,dispatchApplicationReviewedAt,dispatchApplicationRejectionReason,activeSessionId,activeSessionUpdatedAt,accountDisabled,disabledAt,disabledByUid,lastPrivilegedRole,restaurantId,restaurantName,restaurantLinkedAt,restaurantLinkSource,createdAt,updatedAt'
    )
    .eq('uid', uid)
    .maybeSingle<UserAccountRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

const loadUserPhoneNumber = async (uid: string) => {
  const safeUid = sanitizeText(uid);
  if (!safeUid) {
    return null;
  }

  const { data, error } = await serviceClient
    .from('UserAccount')
    .select('phoneNumber')
    .eq('uid', safeUid)
    .maybeSingle<Pick<UserAccountRow, 'phoneNumber'>>();

  if (error) {
    throw new Error(error.message);
  }

  return sanitizeOptionalText(data?.phoneNumber);
};

const loadDispatchRiderPhoneNumber = async (riderId: string | null | undefined) => {
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

const loadUserRoles = async (userIds: string[]) => {
  if (userIds.length === 0) {
    return new Map<string, UserRoleRow[]>();
  }

  const { data, error } = await serviceClient
    .from('UserRole')
    .select('userId,role,restaurantId,assignedByUid')
    .in('userId', userIds);

  if (error) {
    throw new Error(error.message);
  }

  const rolesByUserId = new Map<string, UserRoleRow[]>();
  for (const role of (data ?? []) as UserRoleRow[]) {
    const bucket = rolesByUserId.get(role.userId) ?? [];
    bucket.push(role);
    rolesByUserId.set(role.userId, bucket);
  }

  return rolesByUserId;
};

const loadPartnerApplication = async (applicationId: string) => {
  const { data, error } = await serviceClient
    .from('PartnerApplicationRecord')
    .select(
      'id,uid,email,contactName,phoneNumber,restaurantName,cuisine,address,description,logoImage,latitude,longitude,deliveryTime,status,restaurantId,submittedAt,reviewedAt,approvedByUid,rejectionReason,updatedAt'
    )
    .eq('id', applicationId)
    .maybeSingle<PartnerApplicationRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

const loadDispatchApplication = async (applicationId: string) => {
  const { data, error } = await serviceClient
    .from('DispatchApplicationRecord')
    .select(
      'id,uid,email,displayName,phoneNumber,region,lga,vehicleType,currentAddress,latitude,longitude,status,submittedAt,reviewedAt,approvedByUid,rejectionReason,updatedAt'
    )
    .eq('id', applicationId)
    .maybeSingle<DispatchApplicationRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

const loadRestaurantById = async (restaurantId: string) => {
  const [{ data: restaurant, error: restaurantError }, { data: approval, error: approvalError }] = await Promise.all([
    serviceClient
      .from('RestaurantRecord')
      .select(
        'id,ownerId,name,nameKey,cuisine,address,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,createdAt,updatedAt'
      )
      .eq('id', restaurantId)
      .maybeSingle<RestaurantRecordRow>(),
    serviceClient
      .from('RestaurantApproval')
      .select('restaurantId,status,approvedByUid,approvedAt')
      .eq('restaurantId', restaurantId)
      .maybeSingle<RestaurantApprovalRow>(),
  ]);

  if (restaurantError) {
    throw new Error(restaurantError.message);
  }

  if (approvalError) {
    throw new Error(approvalError.message);
  }

  return {
    approval: approval ?? null,
    restaurant: restaurant ?? null,
  };
};

const loadManagedRestaurantForUser = async (uid: string, role: string) => {
  const userAccount = await loadUserAccount(uid);
  const linkedRestaurantId = sanitizeText(userAccount?.restaurantId);

  if (linkedRestaurantId) {
    const linkedRestaurant = await loadRestaurantById(linkedRestaurantId);
    if (linkedRestaurant.restaurant) {
      return linkedRestaurant;
    }
  }

  const query = serviceClient
    .from('RestaurantRecord')
    .select(
      'id,ownerId,name,nameKey,cuisine,address,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,createdAt,updatedAt'
    )
    .order('updatedAt', { ascending: false })
    .limit(1);

  const filteredQuery = role === 'admin' ? query : query.eq('ownerId', uid);
  const { data: restaurants, error } = await filteredQuery;

  if (error) {
    throw new Error(error.message);
  }

  const restaurant = ((restaurants ?? []) as RestaurantRecordRow[])[0] ?? null;
  if (!restaurant) {
    return {
      approval: null,
      restaurant: null,
    };
  }

  const { data: approval, error: approvalError } = await serviceClient
    .from('RestaurantApproval')
    .select('restaurantId,status,approvedByUid,approvedAt')
    .eq('restaurantId', restaurant.id)
    .maybeSingle<RestaurantApprovalRow>();

  if (approvalError) {
    throw new Error(approvalError.message);
  }

  return {
    approval: approval ?? null,
    restaurant,
  };
};

const flattenRestaurantMenu = (restaurant: RestaurantRecordRow) => {
  const categories = Array.isArray(restaurant.menu) ? restaurant.menu : [];
  return categories.flatMap((category) => {
    const items = Array.isArray((category as JsonObject)?.items) ? ((category as JsonObject).items as unknown[]) : [];

    return items
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const itemRecord = item as JsonObject;
        return {
          id: sanitizeText(itemRecord.id),
          isAvailable: itemRecord.isAvailable !== false,
          name: sanitizeText(itemRecord.name),
          price: parseNumber(itemRecord.price, Number.NaN),
        };
      })
      .filter((item) => item.id && item.name && Number.isFinite(item.price));
  });
};

const buildOrderItems = (requestedItems: unknown, restaurantId: string, restaurant: RestaurantRecordRow) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    fail(400, 'Add at least one item before placing an order.');
  }

  const menuItems = flattenRestaurantMenu(restaurant);
  const menuLookup = new Map(menuItems.map((item) => [item.id, item]));

  return requestedItems.map((item) => {
    const itemRecord = item as JsonObject;
    const itemId = sanitizeText(itemRecord.id);
    const quantity = Number.parseInt(String(itemRecord.quantity ?? ''), 10);

    if (!itemId || !Number.isInteger(quantity) || quantity <= 0) {
      fail(400, 'Each order item must include a valid id and quantity.');
    }

    const menuItem = menuLookup.get(itemId);
    if (!menuItem || menuItem.isAvailable === false) {
      fail(412, 'One or more selected menu items are unavailable.');
    }

    return {
      id: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      quantity,
      restaurantId,
      restaurantName: sanitizeText(restaurant.name, 'Restaurant'),
    };
  });
};

const normalizeDeliveryLocation = (deliveryLocation: unknown) => {
  if (!deliveryLocation || typeof deliveryLocation !== 'object') {
    return null;
  }

  const record = deliveryLocation as JsonObject;
  const address = sanitizeText(record.address);
  const latitude = parseNumber(record.latitude, Number.NaN);
  const longitude = parseNumber(record.longitude, Number.NaN);

  if (!address) {
    return null;
  }

  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    address,
    label: sanitizeOptionalText(record.label),
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    note: sanitizeOptionalText(record.note),
    shortAddress: sanitizeOptionalText(record.shortAddress),
  };
};

const calculateServiceFee = (subtotal: number) => {
  if (subtotal <= 0) {
    return 0;
  }

  return roundCurrency(Math.min(Math.max(subtotal * 0.05, 0.49), 12));
};

const calculateSettlementBreakdown = ({
  deliveryFee,
  subtotal,
}: {
  deliveryFee: number;
  subtotal: number;
}) => {
  const safeSubtotal = roundCurrency(subtotal);
  const dispatchFee = roundCurrency(deliveryFee);
  const platformFee = roundCurrency(safeSubtotal * PLATFORM_COMMISSION_RATE);
  const restaurantPayable = roundCurrency(Math.max(safeSubtotal - platformFee, 0));
  const netSettlement = roundCurrency(restaurantPayable + dispatchFee);

  return {
    basis: 'subtotal',
    commissionRate: PLATFORM_COMMISSION_RATE,
    dispatchFee,
    netSettlement,
    platformFee,
    restaurantPayable,
  };
};

const calculatePricing = ({
  deliveryFee,
  subtotal,
  tip,
}: {
  deliveryFee: number;
  subtotal: number;
  tip: number;
}) => {
  const safeSubtotal = roundCurrency(subtotal);
  const safeDeliveryFee = roundCurrency(deliveryFee);
  const safeTip = roundCurrency(tip);
  const serviceFee = calculateServiceFee(safeSubtotal);
  const settlement = calculateSettlementBreakdown({
    deliveryFee: safeDeliveryFee,
    subtotal: safeSubtotal,
  });
  const total = roundCurrency(safeSubtotal + safeDeliveryFee + serviceFee + safeTip);

  return {
    currency: DEFAULT_CURRENCY,
    deliveryFee: safeDeliveryFee,
    discount: 0,
    dispatchFee: settlement.dispatchFee,
    netSettlement: settlement.netSettlement,
    platformFee: settlement.platformFee,
    restaurantPayable: settlement.restaurantPayable,
    serviceFee,
    settlement,
    subtotal: safeSubtotal,
    tip: safeTip,
    total,
  };
};

const buildInitialPaymentSummary = ({
  paymentMethod,
  reference = null,
  authorizationUrl = null,
  accessCode = null,
  settlement = null,
}: {
  accessCode?: string | null;
  authorizationUrl?: string | null;
  paymentMethod: string;
  reference?: string | null;
  settlement?: JsonObject | null;
}) => {
  if (!PREPAID_PAYMENT_METHODS.has(paymentMethod)) {
    return {
      capturedAmount: 0,
      lastEvent: 'awaiting_cash_collection',
      method: paymentMethod,
      processor: PAYMENT_PROVIDER_CASH,
      reference: null,
      refundAmount: 0,
      refundedAt: null,
      paidAt: null,
      settlement,
      status: PAYMENT_STATUS.PENDING,
    };
  }

  return {
    accessCode,
    authorizationUrl,
    capturedAmount: 0,
    channel: paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'card',
    lastEvent: 'awaiting_customer_payment',
    method: paymentMethod,
    paidAt: null,
    processor: PAYMENT_PROVIDER_PAYSTACK,
    reference,
    refundAmount: 0,
    refundedAt: null,
    settlement,
    status: PAYMENT_STATUS.PENDING,
    verifiedAt: null,
  };
};

const prepareCustomerOrderDraft = async (
  requestData: Record<string, unknown>,
  allowedPaymentMethods: readonly string[]
) => {
  const restaurantId = sanitizeText(requestData.restaurantId);
  const fulfillmentType = sanitizeText(requestData.fulfillmentType, 'delivery');
  const paymentMethod = sanitizeText(requestData.paymentMethod, 'card');
  const idempotencyKey = sanitizeText(requestData.idempotencyKey);
  const tipAmount = roundCurrency(parseNumber(requestData.tipAmount, 0));

  if (!restaurantId) {
    fail(400, 'A restaurant is required to place an order.');
  }

  if (!['delivery', 'pickup'].includes(fulfillmentType)) {
    fail(400, 'Unsupported fulfillment type.');
  }

  if (!['cash', 'card', 'bank_transfer', 'wallet'].includes(paymentMethod)) {
    fail(400, 'Unsupported payment method.');
  }

  if (!allowedPaymentMethods.includes(paymentMethod)) {
    if (paymentMethod === 'wallet') {
      fail(412, 'Wallet payments are still coming soon. Use card, bank transfer, or cash for now.');
    }

    fail(412, 'This checkout flow does not support the selected payment method.');
  }

  if (tipAmount < 0 || tipAmount > 100) {
    fail(400, 'Tip amount is outside the allowed range.');
  }

  const { restaurant, approval } = await loadRestaurantById(restaurantId);
  if (!restaurant) {
    fail(404, 'The selected restaurant no longer exists.');
  }

  if (restaurant.isPublished === false || restaurant.isOpen === false) {
    fail(412, 'This restaurant is not accepting orders right now.');
  }

  if (sanitizeOptionalText(approval?.status) && sanitizeText(approval?.status) !== 'approved') {
    fail(412, 'This restaurant is not accepting orders right now.');
  }

  if (fulfillmentType === 'delivery' && restaurant.supportsDelivery === false) {
    fail(412, 'This restaurant does not support delivery.');
  }

  if (fulfillmentType === 'pickup' && restaurant.supportsPickup === false) {
    fail(412, 'This restaurant does not support pickup.');
  }

  const items = buildOrderItems(requestData.items, restaurantId, restaurant);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = fulfillmentType === 'delivery' ? parseNumber(restaurant.deliveryFee, 0) : 0;
  const minOrder = parseNumber(restaurant.minOrder, 0);

  if (subtotal < minOrder) {
    fail(412, `This restaurant requires a minimum order of ${minOrder.toFixed(2)}.`);
  }

  const deliveryLocation =
    fulfillmentType === 'delivery' ? normalizeDeliveryLocation(requestData.deliveryLocation) : null;
  if (fulfillmentType === 'delivery' && !deliveryLocation) {
    fail(400, 'A valid delivery location is required.');
  }

  const pricing = calculatePricing({
    deliveryFee,
    subtotal,
    tip: tipAmount,
  });

  return {
    deliveryLocation,
    fulfillmentType,
    idempotencyKey,
    items,
    paymentMethod,
    pricing,
    restaurant,
    restaurantId,
  };
};

const createOrderWithItems = async ({
  customerId,
  deliveryLocation,
  fulfillmentType,
  items,
  orderId,
  payment,
  pricing,
  restaurantId,
  restaurantName,
}: {
  customerId: string;
  deliveryLocation: JsonObject | null;
  fulfillmentType: string;
  items: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    restaurantId: string;
    restaurantName: string;
  }>;
  orderId: string;
  payment: JsonObject;
  pricing: JsonObject;
  restaurantId: string;
  restaurantName: string;
}) => {
  const createdAt = nowIso();
  const timeline = {
    placedAt: createdAt,
  };

  const orderInsert = {
    id: orderId,
    customerId,
    restaurantId,
    restaurantName,
    status: ORDER_STATUS.PLACED,
    fulfillmentType,
    pricing,
    payment,
    deliveryAddress: sanitizeOptionalText(deliveryLocation?.address),
    deliveryLocation,
    cancellation: null,
    timeline,
    createdAt,
    updatedAt: createdAt,
  };

  const { error: orderError } = await serviceClient.from('CustomerOrder').insert(orderInsert);
  if (orderError) {
    throw new Error(orderError.message);
  }

  const { error: itemsError } = await serviceClient.from('OrderItem').insert(
    items.map((item) => ({
      orderId,
      itemId: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      restaurantId: item.restaurantId,
      restaurantName: item.restaurantName,
    }))
  );

  if (itemsError) {
    await serviceClient.from('CustomerOrder').delete().eq('id', orderId);
    throw new Error(itemsError.message);
  }

  return {
    createdAt,
    timeline,
  };
};

const upsertPaymentTransaction = async (payload: JsonObject & { reference: string }) => {
  const { error } = await serviceClient.from('PaymentTransaction').upsert(payload, {
    onConflict: 'reference',
  });

  if (error) {
    throw new Error(error.message);
  }
};

const insertDeliveryEvent = async (payload: JsonObject) => {
  const { error } = await serviceClient.from('DeliveryEvent').insert(payload);

  if (error) {
    throw new Error(error.message);
  }
};

const updateOrderRecord = async (orderId: string, updates: JsonObject) => {
  const { error } = await serviceClient.from('CustomerOrder').update(updates).eq('id', orderId);

  if (error) {
    throw new Error(error.message);
  }
};

const loadOrderRelations = async (orderIds: string[]) => {
  if (orderIds.length === 0) {
    return {
      assignmentsByOrderId: new Map<string, DeliveryAssignmentRow>(),
      eventsByOrderId: new Map<string, DeliveryEventRow[]>(),
      itemsByOrderId: new Map<string, OrderItemRow[]>(),
    };
  }

  const [{ data: items, error: itemsError }, { data: assignments, error: assignmentError }, { data: events, error: eventsError }] =
    await Promise.all([
      serviceClient
        .from('OrderItem')
        .select('orderId,itemId,name,price,quantity,restaurantId,restaurantName')
        .in('orderId', orderIds),
      serviceClient
        .from('DeliveryAssignment')
        .select('orderId,dispatchId,courierId,courierName,assignedAt')
        .in('orderId', orderIds),
      serviceClient
        .from('DeliveryEvent')
        .select('id,orderId,eventType,actorUid,note,details,createdAt')
        .in('orderId', orderIds)
        .order('createdAt', { ascending: true }),
    ]);

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  if (eventsError) {
    throw new Error(eventsError.message);
  }

  const itemsByOrderId = new Map<string, OrderItemRow[]>();
  for (const item of (items ?? []) as OrderItemRow[]) {
    const bucket = itemsByOrderId.get(item.orderId) ?? [];
    bucket.push(item);
    itemsByOrderId.set(item.orderId, bucket);
  }

  const assignmentsByOrderId = new Map(
    ((assignments ?? []) as DeliveryAssignmentRow[]).map((assignment) => [assignment.orderId, assignment] as const)
  );

  const eventsByOrderId = new Map<string, DeliveryEventRow[]>();
  for (const event of (events ?? []) as DeliveryEventRow[]) {
    const bucket = eventsByOrderId.get(event.orderId) ?? [];
    bucket.push(event);
    eventsByOrderId.set(event.orderId, bucket);
  }

  return {
    assignmentsByOrderId,
    eventsByOrderId,
    itemsByOrderId,
  };
};

const loadOrdersForCustomer = async (customerId: string) => {
  const { data: orders, error } = await serviceClient
    .from('CustomerOrder')
    .select(
      'id,customerId,restaurantId,restaurantName,status,fulfillmentType,pricing,payment,deliveryAddress,deliveryLocation,cancellation,timeline,createdAt,updatedAt'
    )
    .eq('customerId', customerId)
    .order('createdAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const orderList = (orders ?? []) as CustomerOrderRow[];
  const { assignmentsByOrderId, itemsByOrderId } = await loadOrderRelations(orderList.map((order) => order.id));

  return orderList.map((order) =>
    toOrderSnapshotResponse(
      order,
      itemsByOrderId.get(order.id) ?? [],
      assignmentsByOrderId.get(order.id) ?? null
    )
  );
};

const loadFavoriteRestaurantIds = async (customerId: string) => {
  const { data, error } = await serviceClient
    .from('CustomerFavoriteRestaurant')
    .select('restaurantId,createdAt')
    .eq('customerId', customerId)
    .order('createdAt', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as { restaurantId: string }[]).map((favorite) => favorite.restaurantId);
};

const loadOrderBundle = async (orderId: string, includeEvents = false) => {
  const { data: order, error } = await serviceClient
    .from('CustomerOrder')
    .select(
      'id,customerId,restaurantId,restaurantName,status,fulfillmentType,pricing,payment,deliveryAddress,deliveryLocation,cancellation,timeline,createdAt,updatedAt'
    )
    .eq('id', orderId)
    .maybeSingle<CustomerOrderRow>();

  if (error) {
    throw new Error(error.message);
  }

  if (!order) {
    return null;
  }

  const { assignmentsByOrderId, eventsByOrderId, itemsByOrderId } = await loadOrderRelations([orderId]);
  return {
    assignment: assignmentsByOrderId.get(orderId) ?? null,
    events: includeEvents ? eventsByOrderId.get(orderId) ?? [] : [],
    items: itemsByOrderId.get(orderId) ?? [],
    order,
  };
};

const isOrderOperationallyVisible = (order: CustomerOrderRow) => {
  const paymentMethod = sanitizeText(order.payment?.method, 'cash');
  const paymentStatus = sanitizeText(order.payment?.status, PAYMENT_STATUS.PENDING);
  const currentStatus = normalizeOrderStatus(order.status);

  if (!PREPAID_PAYMENT_METHODS.has(paymentMethod)) {
    return true;
  }

  if (paymentStatus === PAYMENT_STATUS.PAID) {
    return true;
  }

  return TERMINAL_ORDER_STATUSES.has(currentStatus);
};

const assertOrderPaymentReadyForOperations = (order: CustomerOrderRow) => {
  if (!isOrderOperationallyVisible(order)) {
    fail(412, 'This order is still waiting for online payment confirmation and cannot move into kitchen or dispatch yet.');
  }
};

const assertNonTerminalOrder = (order: CustomerOrderRow) => {
  if (TERMINAL_ORDER_STATUSES.has(normalizeOrderStatus(order.status))) {
    fail(412, 'This order can no longer be updated.');
  }
};

const hasAssignedCourier = (assignment: DeliveryAssignmentRow | null) =>
  Boolean(sanitizeText(assignment?.courierId));

const buildPartnerStatusUpdate = (currentStatus: string, action: string) => {
  const currentTimelineAt = nowIso();

  switch (action) {
    case 'accept':
      if (currentStatus !== ORDER_STATUS.PLACED) {
        fail(412, 'Only newly placed orders can be accepted.');
      }

      return {
        status: ORDER_STATUS.ACCEPTED,
        timelinePatch: {
          acceptedAt: currentTimelineAt,
        },
      };
    case 'preparing':
      if (![ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
        fail(412, 'Only accepted orders can move into preparation.');
      }

      return {
        status: ORDER_STATUS.PREPARING,
        timelinePatch: {
          ...(currentStatus === ORDER_STATUS.PLACED ? { acceptedAt: currentTimelineAt } : {}),
          preparingAt: currentTimelineAt,
        },
      };
    case 'ready':
      if (![ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING].includes(currentStatus)) {
        fail(412, 'Only active kitchen orders can be marked ready.');
      }

      return {
        status: ORDER_STATUS.READY_FOR_PICKUP,
        timelinePatch: {
          ...(currentStatus === ORDER_STATUS.ACCEPTED ? { preparingAt: currentTimelineAt } : {}),
          readyAt: currentTimelineAt,
        },
      };
    case 'reject':
      if (![ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
        fail(412, 'Only active incoming orders can be rejected.');
      }

      return {
        status: ORDER_STATUS.REJECTED,
        timelinePatch: {
          cancelledAt: currentTimelineAt,
        },
      };
    default:
      fail(400, 'Unsupported partner order action.');
  }
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

const buildRefundUpdate = ({
  order,
  refundRate,
  reason,
}: {
  order: CustomerOrderRow;
  refundRate: number;
  reason: string;
}) => {
  const existingPayment = (order.payment ?? {}) as JsonObject;
  const paymentMethod = sanitizeText(existingPayment.method, 'cash');
  const capturedAmount = roundCurrency(
    parseNumber(existingPayment.capturedAmount, parseNumber((order.pricing ?? {}).total, 0))
  );

  if (!PREPAID_PAYMENT_METHODS.has(paymentMethod) || capturedAmount <= 0) {
    return {
      ...existingPayment,
      lastEvent: reason,
    };
  }

  const refundAmount = roundCurrency(capturedAmount * refundRate);
  return {
    ...existingPayment,
    lastEvent: reason,
    refundAmount,
    refundedAt: nowIso(),
    status: PAYMENT_STATUS.REFUNDED,
  };
};

const getCustomerCancellationRefundRate = (currentStatus: string) => {
  if ([ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
    return 1;
  }

  if ([ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
    return 0.5;
  }

  return 0;
};

const getPaystackSecretKey = () => sanitizeText(Deno.env.get('PAYSTACK_SECRET_KEY'));
const getPaystackPublicKey = () => sanitizeText(Deno.env.get('PAYSTACK_PUBLIC_KEY'));
const getPaystackCallbackUrl = () => sanitizeOptionalText(Deno.env.get('PAYSTACK_CALLBACK_URL'));

const assertPaystackConfigured = () => {
  if (!getPaystackSecretKey() || !getPaystackPublicKey()) {
    fail(
      412,
      'Paystack is not configured for this backend yet. Add PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY first.'
    );
  }
};

const toKoboAmount = (amount: number) => Math.round(roundCurrency(parseNumber(amount, 0)) * 100);
const fromKoboAmount = (amount: unknown) => roundCurrency(parseNumber(amount, 0) / 100);

const mapPaystackChannels = (paymentMethod: string) => {
  switch (paymentMethod) {
    case 'card':
      return ['card'];
    case 'bank_transfer':
      return ['bank_transfer'];
    default:
      return [];
  }
};

const buildPaystackReference = (orderId: string, paymentMethod: string) => {
  const prefix = paymentMethod === 'bank_transfer' ? 'BNK' : 'CRD';
  return `EBUY-${prefix}-${orderId.slice(-8).toUpperCase()}-${Date.now()}`;
};

const fetchPaystackJson = async ({
  method = 'GET',
  path,
  body = null,
}: {
  body?: JsonObject | null;
  method?: string;
  path: string;
}) => {
  assertPaystackConfigured();

  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getPaystackSecretKey()}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        data?: JsonObject | null;
        message?: string;
        status?: boolean;
      }
    | null;

  if (!response.ok || payload?.status !== true) {
    fail(500, sanitizeText(payload?.message, `Paystack request to ${path} failed.`));
  }

  return (payload?.data ?? null) as JsonObject | null;
};

const initializePaystackTransaction = async ({
  amount,
  callbackUrl,
  email,
  metadata,
  paymentMethod,
  reference,
}: {
  amount: number;
  callbackUrl?: string | null;
  email: string;
  metadata: JsonObject;
  paymentMethod: string;
  reference: string;
}) => {
  const payload: JsonObject = {
    amount: String(toKoboAmount(amount)),
    channels: mapPaystackChannels(paymentMethod),
    currency: DEFAULT_CURRENCY,
    email,
    metadata: JSON.stringify(metadata),
    reference,
  };

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  return (await fetchPaystackJson({
    method: 'POST',
    path: '/transaction/initialize',
    body: payload,
  })) as JsonObject;
};

const verifyPaystackTransaction = async (reference: string) =>
  (await fetchPaystackJson({
    method: 'GET',
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
  })) as JsonObject;

const syncOrderPaymentState = async ({
  order,
  transactionData,
  webhookEvent = null,
}: {
  order: CustomerOrderRow;
  transactionData: JsonObject;
  webhookEvent?: JsonObject | null;
}) => {
  const verifiedAtIso = nowIso();
  const existingPayment = (order.payment ?? {}) as JsonObject;
  const paymentMethod = sanitizeText(
    existingPayment.method,
    sanitizeText(transactionData.channel) === 'bank_transfer' ? 'bank_transfer' : 'card'
  );
  const paymentReference = sanitizeText(transactionData.reference, sanitizeText(existingPayment.reference));
  const transactionStatus = sanitizeText(transactionData.status, 'pending');
  const gatewayStatus = sanitizeText(
    transactionData.gateway_response ?? transactionData.gatewayResponse ?? transactionStatus,
    transactionStatus
  );
  const transactionAmount = fromKoboAmount(transactionData.amount);

  let nextPayment: JsonObject = {
    ...existingPayment,
    accessCode: sanitizeOptionalText(existingPayment.accessCode),
    authorizationUrl: sanitizeOptionalText(existingPayment.authorizationUrl),
    method: paymentMethod,
    processor: PAYMENT_PROVIDER_PAYSTACK,
    reference: paymentReference,
    verifiedAt: verifiedAtIso,
  };

  if (transactionStatus === 'success') {
    nextPayment = {
      ...nextPayment,
      capturedAmount: transactionAmount,
      channel: sanitizeOptionalText(transactionData.channel) ?? sanitizeOptionalText(nextPayment.channel),
      lastEvent: 'paystack_payment_confirmed',
      paidAt:
        sanitizeOptionalText(transactionData.paid_at ?? transactionData.transaction_date) ?? verifiedAtIso,
      status: PAYMENT_STATUS.PAID,
    };
  } else if (['abandoned', 'failed', 'reversed'].includes(transactionStatus)) {
    nextPayment = {
      ...nextPayment,
      channel: sanitizeOptionalText(transactionData.channel) ?? sanitizeOptionalText(nextPayment.channel),
      lastEvent: `paystack_${transactionStatus}`,
      status: PAYMENT_STATUS.FAILED,
    };
  } else {
    nextPayment = {
      ...nextPayment,
      channel: sanitizeOptionalText(transactionData.channel) ?? sanitizeOptionalText(nextPayment.channel),
      lastEvent: `paystack_${transactionStatus}`,
      status: PAYMENT_STATUS.PENDING,
    };
  }

  await updateOrderRecord(order.id, {
    payment: nextPayment,
    updatedAt: verifiedAtIso,
  });

  await upsertPaymentTransaction({
    orderId: order.id,
    customerId: order.customerId,
    restaurantId: order.restaurantId,
    provider: PAYMENT_PROVIDER_PAYSTACK,
    method: paymentMethod,
    reference: paymentReference,
    currency: DEFAULT_CURRENCY,
    amount: parseNumber((order.pricing ?? {}).total, 0),
    status: sanitizeText(nextPayment.status, PAYMENT_STATUS.PENDING),
    accessCode: sanitizeOptionalText(existingPayment.accessCode),
    authorizationUrl: sanitizeOptionalText(existingPayment.authorizationUrl),
    externalTransactionId:
      transactionData.id === null || transactionData.id === undefined ? null : String(transactionData.id),
    channel: sanitizeOptionalText(transactionData.channel),
    gatewayStatus,
    lastError:
      sanitizeText(nextPayment.status) === PAYMENT_STATUS.FAILED
        ? sanitizeOptionalText(transactionData.message) ?? gatewayStatus
        : null,
    paidAt: sanitizeText(nextPayment.status) === PAYMENT_STATUS.PAID ? nextPayment.paidAt ?? verifiedAtIso : null,
    failedAt: sanitizeText(nextPayment.status) === PAYMENT_STATUS.FAILED ? verifiedAtIso : null,
    verifiedAt: verifiedAtIso,
    verificationResponse: transactionData,
    webhookEvent,
    updatedAt: verifiedAtIso,
  });

  if (sanitizeText(nextPayment.status) === PAYMENT_STATUS.PAID) {
    await insertDeliveryEvent({
      orderId: order.id,
      eventType: 'payment_confirmed',
      actorUid: null,
      details: {
        amount: transactionAmount,
        provider: PAYMENT_PROVIDER_PAYSTACK,
        reference: paymentReference,
      },
    });
    await notifyRestaurantUsers(order.restaurantId, {
      title: 'Paid order received',
      body: `Order ${order.id.slice(-6).toUpperCase()} is paid and ready for confirmation.`,
      data: buildNotificationData({
        app: 'partner',
        orderId: order.id,
        routeKey: 'partner_order_detail',
        type: 'order_update',
      }),
    });
  }

  return nextPayment;
};

const refreshPaystackPaymentForOrder = async (order: CustomerOrderRow, webhookEvent: JsonObject | null = null) => {
  const paymentReference = sanitizeText(order.payment?.reference);
  if (!paymentReference) {
    fail(412, 'This order does not have a Paystack reference to verify.');
  }

  const { data: paymentRecord, error: paymentError } = await serviceClient
    .from('PaymentTransaction')
    .select(
      'orderId,customerId,restaurantId,method,reference,status,accessCode,authorizationUrl,channel,gatewayStatus,lastError'
    )
    .eq('reference', paymentReference)
    .maybeSingle<PaymentTransactionRow>();

  if (paymentError) {
    throw new Error(paymentError.message);
  }

  const verifiedTransaction = await verifyPaystackTransaction(paymentReference);
  const expectedAmountKobo = toKoboAmount(parseNumber((order.pricing ?? {}).total, 0));
  const actualAmountKobo = parseInteger(verifiedTransaction.amount, -1);

  if (actualAmountKobo !== expectedAmountKobo) {
    fail(412, 'Verified Paystack amount does not match the expected order total.');
  }

  return syncOrderPaymentState({
    order,
    transactionData: verifiedTransaction,
    webhookEvent,
  });
};

const normalizePartnerMenuInput = (menu: unknown) => {
  const allowedMenuCategories = new Map([
    ['rice', 'Rice'],
    ['swallow', 'Swallow'],
    ['soups', 'Soups'],
    ['proteins', 'Proteins'],
    ['snacks', 'Snacks'],
    ['drinks', 'Drinks'],
  ]);

  const inferMenuCategoryId = (value: string) => {
    const normalizedValue = value.trim().toLowerCase();

    if (/(rice|jollof|ofada|biryani)/.test(normalizedValue)) {
      return 'rice';
    }

    if (/(swallow|amala|eba|fufu|semo|pounded yam)/.test(normalizedValue)) {
      return 'swallow';
    }

    if (/(soup|egusi|efo|ogbono|banga|okra|oha|afang)/.test(normalizedValue)) {
      return 'soups';
    }

    if (/(chicken|beef|fish|turkey|goat|suya|protein|meat)/.test(normalizedValue)) {
      return 'proteins';
    }

    if (/(drink|juice|water|soda|zobo|smoothie|tea|coffee)/.test(normalizedValue)) {
      return 'drinks';
    }

    return 'snacks';
  };

  if (!Array.isArray(menu)) {
    fail(400, 'Menu payload must be an array of categories.');
  }

  return menu.map((category, categoryIndex) => {
    const categoryRecord = category as JsonObject;
    const categoryName = sanitizeText(categoryRecord.category);

    if (!categoryName) {
      fail(400, `Menu category ${categoryIndex + 1} needs a valid category name.`);
    }

    const items = Array.isArray(categoryRecord.items) ? categoryRecord.items : [];
    if (items.length === 0) {
      fail(400, `Menu category "${categoryName}" must include at least one item.`);
    }

    return {
      category: categoryName,
      items: items.map((item, itemIndex) => {
        const itemRecord = item as JsonObject;
        const itemId = sanitizeText(itemRecord.id);
        const itemName = sanitizeText(itemRecord.name);
        const itemDescription = sanitizeOptionalText(itemRecord.description) ?? '';
        const itemPrice = roundCurrency(parseNumber(itemRecord.price, Number.NaN));
        const rawCategoryId = sanitizeOptionalText(itemRecord.categoryId)?.toLowerCase();
        const fallbackCategoryId = inferMenuCategoryId(
          sanitizeOptionalText(itemRecord.categoryLabel) ?? rawCategoryId ?? categoryName
        );
        const categoryId = rawCategoryId && allowedMenuCategories.has(rawCategoryId) ? rawCategoryId : fallbackCategoryId;
        const categoryLabel = allowedMenuCategories.get(categoryId);

        if (!itemId || !itemName || !Number.isFinite(itemPrice) || itemPrice <= 0) {
          fail(
            400,
            `Menu item ${itemIndex + 1} in "${categoryName}" is missing a valid id, name, or price.`
          );
        }

        if (!categoryLabel) {
          fail(
            400,
            `Menu item ${itemIndex + 1} in "${categoryName}" has an unsupported customer category.`
          );
        }

        return {
          categoryId,
          categoryLabel,
          description: itemDescription,
          id: itemId,
          image: sanitizeOptionalText(itemRecord.image),
          isAvailable: itemRecord.isAvailable !== false,
          name: itemName,
          price: itemPrice,
        };
      }),
    };
  });
};

const buildPartnerRestaurantPayload = (
  input: Record<string, unknown>,
  uid: string,
  options: { allowPublish?: boolean; existingPublished?: boolean } = {}
) => {
  const name = sanitizeText(input.name);
  const allowPublish = options.allowPublish === true;
  const existingPublished = options.existingPublished === true;

  if (!name) {
    fail(400, 'A restaurant name is required.');
  }

  const supportsDelivery = input.supportsDelivery !== false;
  const supportsPickup = input.supportsPickup !== false;
  if (!supportsDelivery && !supportsPickup) {
    fail(400, 'Enable delivery, pickup, or both before saving.');
  }

  const latitude = input.latitude === null || input.latitude === undefined ? null : parseNumber(input.latitude, Number.NaN);
  const longitude = input.longitude === null || input.longitude === undefined ? null : parseNumber(input.longitude, Number.NaN);
  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;

  if (hasLatitude !== hasLongitude) {
    fail(400, 'Provide both latitude and longitude together.');
  }

  if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    fail(400, 'Use valid numeric coordinates for the restaurant.');
  }

  const address = sanitizeText(input.address);
  if (!address) {
    fail(400, 'A restaurant address is required.');
  }

  const openingTime = normalizeOperatingTime(input.openingTime, 'Opening time');
  const closingTime = normalizeOperatingTime(input.closingTime, 'Closing time');

  if (!openingTime || !closingTime) {
    fail(400, 'Add both opening and closing time before saving.');
  }

  return {
    address,
    closingTime,
    cuisine: sanitizeOptionalText(input.cuisine) ?? '',
    deliveryFee: roundCurrency(parseNumber(input.deliveryFee, 0)),
    deliveryRadiusKm:
      input.deliveryRadiusKm === null || input.deliveryRadiusKm === undefined
        ? null
        : roundCurrency(parseNumber(input.deliveryRadiusKm, 0)),
    deliveryTime: sanitizeText(input.deliveryTime, DEFAULT_DELIVERY_TIME),
    description: sanitizeOptionalText(input.description) ?? '',
    image: sanitizeOptionalText(input.image) ?? '',
    logoImage: sanitizeOptionalText(input.logoImage) ?? '',
    isOpen: input.isOpen !== false,
    isPublished: allowPublish ? input.isPublished === true : existingPublished,
    latitude,
    longitude,
    minOrder: roundCurrency(parseNumber(input.minOrder, 0)),
    name,
    nameKey: buildNameKey(name),
    openingTime,
    ownerId: uid,
    supportsDelivery,
    supportsPickup,
  };
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

const upsertUserRoleLink = async (
  userId: string,
  role: string,
  restaurantId: string | null,
  assignedByUid: string | null = null
) => {
  const { error: deleteError } = await serviceClient
    .from('UserRole')
    .delete()
    .eq('userId', userId)
    .neq('role', role);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const { error } = await serviceClient.from('UserRole').upsert(
    {
      userId,
      role,
      restaurantId,
      assignedByUid,
      updatedAt: nowIso(),
    },
    { onConflict: 'userId,role' }
  );

  if (error) {
    throw new Error(error.message);
  }
};

const deleteUserRoleLinks = async (userId: string) => {
  const { error } = await serviceClient.from('UserRole').delete().eq('userId', userId);
  if (error) {
    throw new Error(error.message);
  }
};

const updateUserAccount = async (uid: string, updates: JsonObject) => {
  const { error } = await serviceClient.from('UserAccount').update(updates).eq('uid', uid);
  if (error) {
    throw new Error(error.message);
  }
};

const upsertUserAccount = async (record: JsonObject) => {
  const { error } = await serviceClient.from('UserAccount').upsert(record, { onConflict: 'uid' });
  if (error) {
    throw new Error(error.message);
  }
};

const extractClaimText = (claims: Record<string, unknown>, key: string) =>
  typeof claims[key] === 'string' && claims[key].trim() ? claims[key].trim() : null;

const getBootstrapRequestContext = async (request: Request) => {
  const { claims, token } = await verifySupabaseJwt(request);
  const uid = extractClaimText(claims as Record<string, unknown>, 'sub');
  const email = extractClaimText(claims as Record<string, unknown>, 'email')?.toLowerCase();
  const role = extractClaimText(claims as Record<string, unknown>, 'user_role') ?? 'customer';

  if (!uid || !email) {
    fail(401, 'Authenticated bootstrap request is missing a valid user identity.');
  }

  const existingAccount = await loadUserAccount(uid);
  if (!existingAccount) {
    const now = nowIso();
    await upsertUserAccount({
      uid,
      email,
      displayName: email.split('@')[0],
      emailVerified: true,
      roleDisplay: role,
      accountDisabled: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    email,
    role,
    token,
    uid,
    userProfile: {
      accountDisabled: false,
      email,
      role,
      uid,
    },
  };
};

const deleteUserAccount = async (uid: string) => {
  const { error } = await serviceClient.from('UserAccount').delete().eq('uid', uid);
  if (error) {
    throw new Error(error.message);
  }
};

const syncUserRoleState = async (
  targetUid: string,
  role: string,
  assignedByUid: string | null,
  options: {
    accountDisabled?: boolean;
    disabledAt?: string | null;
    disabledByUid?: string | null;
    lastPrivilegedRole?: string | null;
    restaurantId?: string | null;
    restaurantLinkedAt?: string | null;
    restaurantLinkSource?: string | null;
    restaurantName?: string | null;
  } = {}
) => {
  await upsertUserRoleLink(targetUid, role, options.restaurantId ?? null, assignedByUid);
  await updateSupabaseAuthUser(targetUid, {
    app_metadata: {
      app_role: role,
      role,
      user_role: role,
    },
    ...(options.accountDisabled === true ? { ban_duration: '876000h' } : { ban_duration: 'none' }),
  }).catch(() => undefined);
  await updateUserAccount(targetUid, {
    accountDisabled: options.accountDisabled === true,
    disabledAt: options.disabledAt ?? null,
    disabledByUid: options.disabledByUid ?? null,
    lastPrivilegedRole:
      options.lastPrivilegedRole !== undefined
        ? options.lastPrivilegedRole
        : PRIVILEGED_APP_ROLES.has(role)
          ? role
          : null,
    ...(options.restaurantId !== undefined ? { restaurantId: options.restaurantId } : null),
    ...(options.restaurantLinkedAt !== undefined ? { restaurantLinkedAt: options.restaurantLinkedAt } : null),
    ...(options.restaurantLinkSource !== undefined ? { restaurantLinkSource: options.restaurantLinkSource } : null),
    ...(options.restaurantName !== undefined ? { restaurantName: options.restaurantName } : null),
    roleDisplay: role,
    updatedAt: nowIso(),
  });
};

const handleNativeAction = async (
  action: string,
  request: Request,
  data: Record<string, unknown>
) => {
  if (action === 'bootstrapFirstAdmin') {
    const context = await getBootstrapRequestContext(request);
    const allowedEmails = getBootstrapAdminEmails();
    if (!allowedEmails.includes(context.email.toLowerCase())) {
      fail(403, 'This account is not allowed to run the first-admin bootstrap flow.');
    }

    const { count, error } = await serviceClient
      .from('UserRole')
      .select('userId', { count: 'exact', head: true })
      .eq('role', 'admin');

    if (error) {
      throw new Error(error.message);
    }

    if ((count ?? 0) > 0) {
      fail(412, 'An admin account already exists. Use the admin access tools for further role changes.');
    }

    await syncUserRoleState(context.uid, 'admin', context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: 'admin',
    });
    await createAuditEntry(context.uid, 'first_admin_bootstrapped', 'user_role', context.uid, {
      email: context.email.toLowerCase(),
    });
    await notifyUsers([context.uid], {
      title: 'Admin access enabled',
      body: 'This account is now the first platform admin.',
      data: buildNotificationData({
        app: 'admin',
        routeKey: 'admin_access',
        type: 'staff_access',
      }),
    });

    return json(200, {
      data: {
        role: 'admin',
        targetUid: context.uid,
        tokenRefreshRequired: true,
      },
    });
  }

  const context = await getAuthenticatedRequestContext(request);

  if (action === 'provisionStaffAccount') {
    ensureRole(context.role, ['admin']);
    const email = sanitizeText(data.email).toLowerCase();
    const password = sanitizeText(data.password);
    const displayName = sanitizeOptionalText(data.displayName);
    const role = sanitizeText(data.role);

    if (!email) {
      fail(400, 'A staff email is required.');
    }

    if (!password || password.length < 6) {
      fail(400, 'Use a password with at least 6 characters.');
    }

    if (!['restaurant', 'dispatch', 'admin'].includes(role)) {
      fail(400, 'Only admin, restaurant, and dispatch staff can be provisioned here.');
    }

    let authUser = await findSupabaseAuthUserByEmail(email);
    let created = false;

    if (!authUser) {
      authUser = await createSupabaseAuthUser({
        displayName,
        email,
        emailConfirmed: true,
        password,
        role,
      });
      created = true;
    } else {
      authUser = await updateSupabaseAuthUser(sanitizeText(String(authUser.id ?? authUser.user?.id ?? authUser.uid)), {
        app_metadata: {
          app_role: role,
          role,
          user_role: role,
        },
        ban_duration: 'none',
        email_confirm: true,
        password,
        user_metadata: displayName
          ? {
              full_name: displayName,
            }
          : undefined,
      });
    }

    const targetUid = sanitizeText(String(authUser.id ?? authUser.user?.id ?? authUser.uid));
    if (!targetUid) {
      fail(500, 'The provisioned auth account is missing a uid.');
    }

    const existingAccount = await loadUserAccount(targetUid);
    const now = nowIso();
    await upsertUserAccount({
      uid: targetUid,
      email,
      displayName:
        displayName ?? sanitizeOptionalText(authUser.user_metadata?.full_name) ?? existingAccount?.displayName ?? email.split('@')[0],
      emailVerified: Boolean(authUser.email_confirmed_at ?? true),
      phoneNumber: existingAccount?.phoneNumber ?? null,
      createdAt: existingAccount?.createdAt ?? now,
      updatedAt: now,
      roleDisplay: role,
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: role,
    });
    await syncUserRoleState(targetUid, role, context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: role,
    });
    await createAuditEntry(context.uid, 'staff_account_provisioned', 'user', targetUid, {
      created,
      email,
      role,
    });
    await notifyUsers([targetUid], {
      title: 'Staff access provisioned',
      body: `Your ${role} account is ready. Sign in to continue.`,
      data: buildNotificationData({
        app: role === 'admin' ? 'admin' : role === 'dispatch' ? 'dispatch' : 'partner',
        role,
        routeKey: role === 'admin' ? 'admin_profile' : role === 'dispatch' ? 'dispatch_profile' : 'partner_profile',
        type: 'staff_access',
      }),
    });

    return json(200, {
      data: {
        created,
        email,
        role,
        targetUid,
        tokenRefreshRequired: true,
      },
    });
  }

  if (action === 'assignUserRole') {
    ensureRole(context.role, ['admin']);
    const targetUid = sanitizeText(data.targetUid);
    const nextRole = sanitizeText(data.role);
    if (!targetUid) {
      fail(400, 'A target uid is required.');
    }
    if (!isAppRole(nextRole)) {
      fail(400, 'Use a valid app role when assigning access.');
    }

    const account = await loadUserAccount(targetUid);
    if (!account) {
      fail(404, 'The selected user could not be found.');
    }

    await syncUserRoleState(targetUid, nextRole, context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: PRIVILEGED_APP_ROLES.has(nextRole) ? nextRole : null,
    });
    await createAuditEntry(context.uid, 'role_assigned', 'user_role', targetUid, {
      role: nextRole,
    });
    await notifyUsers([targetUid], {
      title: 'Access role updated',
      body: `Your access role is now ${nextRole}. Refresh your session if the app prompts for it.`,
      data: buildNotificationData({
        app: nextRole === 'admin' ? 'admin' : nextRole === 'dispatch' ? 'dispatch' : nextRole === 'restaurant' ? 'partner' : 'customer',
        role: nextRole,
        routeKey:
          nextRole === 'admin'
            ? 'admin_access'
            : nextRole === 'dispatch'
              ? 'dispatch_profile'
              : nextRole === 'restaurant'
                ? 'partner_profile'
                : 'customer_profile',
        type: 'staff_access',
      }),
    });

    return json(200, {
      data: {
        assignedBy: context.uid,
        role: nextRole,
        targetUid,
        tokenRefreshRequired: true,
      },
    });
  }

  if (action === 'revokeUserRole') {
    ensureRole(context.role, ['admin']);
    const targetUid = sanitizeText(data.targetUid);
    if (!targetUid) {
      fail(400, 'A target uid is required.');
    }

    const account = await loadUserAccount(targetUid);
    if (!account) {
      fail(404, 'The selected user could not be found.');
    }

    await syncUserRoleState(targetUid, 'customer', context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
    });
    await createAuditEntry(context.uid, 'role_revoked', 'user_role', targetUid, {
      role: 'customer',
    });
    await notifyUsers([targetUid], {
      title: 'Privileged access removed',
      body: 'This account has been returned to standard customer access.',
      data: buildNotificationData({
        app: 'customer',
        role: 'customer',
        routeKey: 'customer_profile',
        type: 'staff_access',
      }),
    });

    return json(200, {
      data: {
        revokedBy: context.uid,
        role: 'customer',
        targetUid,
        tokenRefreshRequired: true,
      },
    });
  }

  if (action === 'disableUserAccess') {
    ensureRole(context.role, ['admin']);
    const targetUid = sanitizeText(data.targetUid);
    if (!targetUid) {
      fail(400, 'A target uid is required.');
    }
    if (targetUid === context.uid) {
      fail(412, 'Use a separate trusted admin before disabling the signed-in operator.');
    }

    const account = await loadUserAccount(targetUid);
    if (!account) {
      fail(404, 'The selected user could not be found.');
    }

    const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
    const previousRole = resolvePrimaryRole(account, roles);
    const previousPrivilegedRole = PRIVILEGED_APP_ROLES.has(previousRole) ? previousRole : null;

    await syncUserRoleState(targetUid, 'customer', context.uid, {
      accountDisabled: true,
      disabledAt: nowIso(),
      disabledByUid: context.uid,
      lastPrivilegedRole: previousPrivilegedRole,
    });
    await updateUserAccount(targetUid, {
      activeSessionId: `disabled:${Date.now()}`,
      activeSessionUpdatedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await createAuditEntry(context.uid, 'user_access_disabled', 'user', targetUid, {
      previousPrivilegedRole,
      role: 'customer',
    });
    await notifyUsers([targetUid], {
      title: 'Account access disabled',
      body: 'An admin disabled this account. Contact your platform administrator for restore access.',
      data: buildNotificationData({
        app: 'customer',
        routeKey: 'customer_login',
        type: 'staff_access',
      }),
    });

    return json(200, {
      data: {
        disabled: true,
        role: 'customer',
        targetUid,
      },
    });
  }

  if (action === 'enableUserAccess') {
    ensureRole(context.role, ['admin']);
    const targetUid = sanitizeText(data.targetUid);
    if (!targetUid) {
      fail(400, 'A target uid is required.');
    }

    const account = await loadUserAccount(targetUid);
    if (!account) {
      fail(404, 'The selected user could not be found.');
    }

    const restoreRole = sanitizeText(account.lastPrivilegedRole);
    if (!PRIVILEGED_APP_ROLES.has(restoreRole)) {
      fail(412, 'No previous privileged role is recorded for this account. Re-provision or assign a role first.');
    }

    await syncUserRoleState(targetUid, restoreRole, context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: restoreRole,
    });
    await updateUserAccount(targetUid, {
      activeSessionId: null,
      activeSessionUpdatedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await createAuditEntry(context.uid, 'user_access_enabled', 'user', targetUid, {
      role: restoreRole,
    });
    await notifyUsers([targetUid], {
      title: 'Account access restored',
      body: `Your ${restoreRole} access has been restored.`,
      data: buildNotificationData({
        app: restoreRole === 'admin' ? 'admin' : restoreRole === 'dispatch' ? 'dispatch' : 'partner',
        role: restoreRole,
        routeKey: restoreRole === 'admin' ? 'admin_access' : restoreRole === 'dispatch' ? 'dispatch_profile' : 'partner_profile',
        type: 'staff_access',
      }),
    });

    return json(200, {
      data: {
        enabled: true,
        role: restoreRole,
        targetUid,
        tokenRefreshRequired: true,
      },
    });
  }

  if (action === 'syncUserClaims') {
    const targetUid = sanitizeText(data.targetUid, context.uid);
    if (targetUid !== context.uid) {
      ensureRole(context.role, ['admin']);
    }

    const account = await loadUserAccount(targetUid);
    if (!account) {
      fail(404, 'The selected user could not be found.');
    }

    const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
    const resolvedRole = resolvePrimaryRole(account, roles);

    if (targetUid === context.uid && context.role !== 'admin' && PRIVILEGED_APP_ROLES.has(resolvedRole) && resolvedRole !== context.role) {
      fail(403, 'Only admins can provision privileged role claims. Ask an admin to finish setting up this account.');
    }

    if (targetUid === context.uid && context.role !== 'admin' && resolvedRole !== context.role) {
      fail(403, 'Your profile role does not match your authenticated access claim.');
    }

    await updateSupabaseAuthUser(targetUid, {
      app_metadata: {
        app_role: resolvedRole,
        role: resolvedRole,
        user_role: resolvedRole,
      },
    }).catch(() => undefined);

    return json(200, {
      data: {
        role: resolvedRole,
        targetUid,
        tokenRefreshRequired: true,
      },
    });
  }

  if (action === 'deleteOwnAccount') {
    if (context.role === 'admin') {
      fail(403, 'Admin accounts must be offboarded from the admin access console so audit history stays intact.');
    }

    const account = await loadUserAccount(context.uid);
    if (!account) {
      fail(404, 'The signed-in account could not be found.');
    }

    if (context.role === 'restaurant') {
      const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);
      if (managedRestaurant.restaurant || sanitizeOptionalText(account.restaurantId)) {
        fail(
          412,
          'Partner accounts linked to a restaurant must be offboarded by admin so store ownership and order history stay traceable.'
        );
      }
    }

    if (context.role === 'dispatch') {
      const [{ data: rider, error: riderError }, { data: assignments, error: assignmentError }] = await Promise.all([
        serviceClient
          .from('DispatchRiderRecord')
          .select('id,activeLoad')
          .eq('id', context.uid)
          .maybeSingle<{ id: string; activeLoad?: number | null }>(),
        serviceClient
          .from('DeliveryAssignment')
          .select('orderId,courierId')
          .eq('courierId', context.uid),
      ]);

      if (riderError) {
        throw new Error(riderError.message);
      }
      if (assignmentError) {
        throw new Error(assignmentError.message);
      }

      const orderIds = (assignments ?? []).map((entry) => sanitizeText((entry as { orderId?: string }).orderId)).filter(Boolean);
      let hasOpenAssignments = false;
      if (orderIds.length > 0) {
        const { data: orders, error: orderError } = await serviceClient
          .from('CustomerOrder')
          .select('id,status')
          .in('id', orderIds);

        if (orderError) {
          throw new Error(orderError.message);
        }

        hasOpenAssignments = (orders ?? []).some(
          (order) => !TERMINAL_ORDER_STATUSES.has(normalizeOrderStatus((order as { status?: string }).status))
        );
      }

      if (parseInteger(rider?.activeLoad, 0) > 0 || hasOpenAssignments) {
        fail(
          412,
          'Dispatch accounts with active delivery work must be offboarded by admin after assignments are cleared.'
        );
      }
    }

    await createAuditEntry(context.uid, 'self_account_deleted', 'user', context.uid, {
      role: context.role,
    });
    await updateSupabaseAuthUser(context.uid, {
      ban_duration: '876000h',
    }).catch(() => undefined);

    const cleanupOperations = await Promise.allSettled([
      (async () => {
        const { error } = await serviceClient.from('DispatchApplicationRecord').delete().eq('id', context.uid);
        if (error) {
          throw new Error(error.message);
        }
      })(),
      (async () => {
        const { error } = await serviceClient.from('PartnerApplicationRecord').delete().eq('id', context.uid);
        if (error) {
          throw new Error(error.message);
        }
      })(),
      (async () => {
        const { error } = await serviceClient.from('DispatchRiderRecord').delete().eq('id', context.uid);
        if (error) {
          throw new Error(error.message);
        }
      })(),
      deleteUserRoleLinks(context.uid),
      deleteUserAccount(context.uid),
    ]);

    const cleanupFailures = cleanupOperations.filter((result) => result.status === 'rejected');
    if (cleanupFailures.length > 0) {
      await updateSupabaseAuthUser(context.uid, {
        ban_duration: 'none',
      }).catch(() => undefined);
      fail(
        409,
        'Account deletion could not be completed cleanly. No records were removed from sign-in, so try again or contact support.'
      );
    }

    await deleteSupabaseAuthUser(context.uid);

    return json(200, {
      data: {
        deleted: true,
        targetUid: context.uid,
      },
    });
  }

  if (action === 'submitDispatchApplication') {
    const displayName = sanitizeText(data.displayName);
    const phoneNumber = sanitizeText(data.phoneNumber);
    const region = sanitizeText(data.region);
    const lga = sanitizeText(data.lga);
    const vehicleType = sanitizeText(data.vehicleType);
    const currentAddress = sanitizeOptionalText(data.currentAddress);

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
        status: DISPATCH_APPLICATION_STATUS.PENDING,
        submittedAt,
        reviewedAt: null,
        approvedByUid: null,
        rejectionReason: null,
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
    await createAuditEntry(context.uid, 'dispatch_application_submitted', 'dispatch_application', context.uid, {
      lga,
      region,
      vehicleType,
    });
    await notifyAdmins({
      title: 'New dispatch application',
      body: `${displayName} applied for dispatch access in ${region}.`,
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
  }

  if (action === 'submitPartnerApplication') {
    const contactName = sanitizeText(data.contactName);
    const phoneNumber = sanitizeText(data.phoneNumber);
    const restaurantName = sanitizeText(data.restaurantName);
    const cuisine = sanitizeText(data.cuisine);
      const address = sanitizeText(data.address);
      const description = sanitizeOptionalText(data.description);
      const logoImage = sanitizeOptionalText(data.logoImage);
      const deliveryTime = sanitizeOptionalText(data.deliveryTime) ?? DEFAULT_DELIVERY_TIME;
    const latitude =
      data.latitude === null || data.latitude === undefined ? null : parseNumber(data.latitude, Number.NaN);
    const longitude =
      data.longitude === null || data.longitude === undefined ? null : parseNumber(data.longitude, Number.NaN);

    if (!contactName) {
      fail(400, 'A contact name is required.');
    }
    if (!phoneNumber) {
      fail(400, 'A phone number is required.');
    }
    if (!restaurantName) {
      fail(400, 'A restaurant name is required.');
    }
    if (!cuisine) {
      fail(400, 'A cuisine is required.');
    }
    if (!address) {
      fail(400, 'A restaurant address is required.');
    }

    const hasLatitude = latitude !== null;
    const hasLongitude = longitude !== null;
    if (hasLatitude !== hasLongitude) {
      fail(400, 'Provide both latitude and longitude together.');
    }
    if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      fail(400, 'Use valid numeric coordinates for the restaurant location.');
    }

    const existingApplication = await loadPartnerApplication(context.uid);
    const currentStatus = sanitizeText(existingApplication?.status, PARTNER_APPLICATION_STATUS.PENDING);
    if (existingApplication && currentStatus === PARTNER_APPLICATION_STATUS.APPROVED) {
      fail(
        412,
        'This partner application has already been approved. Sign in from the partner login screen.'
      );
    }

    const submittedAt = existingApplication?.submittedAt ?? nowIso();
    const updatedAt = nowIso();

    const { error: applicationError } = await serviceClient.from('PartnerApplicationRecord').upsert(
      {
        id: context.uid,
        uid: context.uid,
        email: context.email,
        contactName,
        phoneNumber,
        restaurantName,
        cuisine,
          address,
          description,
          logoImage,
          latitude: hasLatitude ? latitude : null,
        longitude: hasLongitude ? longitude : null,
        deliveryTime,
        status: PARTNER_APPLICATION_STATUS.PENDING,
        restaurantId: existingApplication?.restaurantId ?? null,
        submittedAt,
        reviewedAt: null,
        approvedByUid: null,
        rejectionReason: null,
        updatedAt,
      },
      { onConflict: 'id' }
    );

    if (applicationError) {
      throw new Error(applicationError.message);
    }

    const currentAccount = await loadUserAccount(context.uid);
    await upsertUserAccount({
      uid: context.uid,
      email: context.email,
      displayName: contactName,
      phoneNumber,
      emailVerified: true,
      roleDisplay: 'customer',
      partnerApplicationStatus: PARTNER_APPLICATION_STATUS.PENDING,
      partnerApplicationReviewedAt: null,
      partnerApplicationRejectionReason: null,
      createdAt: currentAccount?.createdAt ?? updatedAt,
      updatedAt,
    });
    await createAuditEntry(context.uid, 'partner_application_submitted', 'partner_application', context.uid, {
      cuisine,
        restaurantName,
        logoImage: logoImage ?? null,
      });
    await notifyAdmins({
      title: 'New partner application',
      body: `${restaurantName} submitted a partner application.`,
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
        status: PARTNER_APPLICATION_STATUS.PENDING,
        submittedAt,
        targetUid: context.uid,
      },
    });
  }

  if (action === 'adminGetApprovalQueue') {
    ensureRole(context.role, ['admin']);

    const [
      { data: restaurants, error: restaurantError },
      { data: approvals, error: approvalError },
      { data: dispatchApplications, error: dispatchError },
      { data: partnerApplications, error: partnerError },
    ] = await Promise.all([
      serviceClient
        .from('RestaurantRecord')
        .select(
          'id,ownerId,name,nameKey,cuisine,address,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,createdAt,updatedAt'
        )
        .order('isPublished', { ascending: true })
        .order('updatedAt', { ascending: false }),
      serviceClient
        .from('RestaurantApproval')
        .select('restaurantId,status,approvedByUid,approvedAt'),
      serviceClient
        .from('DispatchApplicationRecord')
        .select(
          'id,uid,email,displayName,phoneNumber,region,lga,vehicleType,currentAddress,latitude,longitude,status,submittedAt,reviewedAt,approvedByUid,rejectionReason,updatedAt'
        )
        .order('submittedAt', { ascending: false }),
      serviceClient
        .from('PartnerApplicationRecord')
        .select(
          'id,uid,email,contactName,phoneNumber,restaurantName,cuisine,address,description,logoImage,latitude,longitude,deliveryTime,status,restaurantId,submittedAt,reviewedAt,approvedByUid,rejectionReason,updatedAt'
        )
        .order('submittedAt', { ascending: false }),
    ]);

    if (restaurantError) {
      throw new Error(restaurantError.message);
    }
    if (approvalError) {
      throw new Error(approvalError.message);
    }
    if (dispatchError) {
      throw new Error(dispatchError.message);
    }
    if (partnerError) {
      throw new Error(partnerError.message);
    }

    const approvalByRestaurantId = new Map(
      ((approvals ?? []) as RestaurantApprovalRow[]).map((approval) => [approval.restaurantId, approval])
    );

    return json(200, {
      data: {
        dispatchApplications: ((dispatchApplications ?? []) as DispatchApplicationRow[]).map(
          buildDispatchApplicationResponse
        ),
        partnerApplications: ((partnerApplications ?? []) as PartnerApplicationRow[]).map(
          buildPartnerApplicationResponse
        ),
        restaurants: ((restaurants ?? []) as RestaurantRecordRow[]).map((restaurant) =>
          buildRestaurantResponse(restaurant, approvalByRestaurantId.get(restaurant.id) ?? null)
        ),
      },
    });
  }

  if (action === 'adminReviewDispatchApplication') {
    ensureRole(context.role, ['admin']);
    const applicationId = sanitizeText(data.applicationId);
    const decision = sanitizeText(data.decision);
    const rejectionReason = sanitizeOptionalText(data.rejectionReason);

    if (!applicationId) {
      fail(400, 'A dispatch application id is required.');
    }
    if (!['approve', 'reject'].includes(decision)) {
      fail(400, 'Use approve or reject when reviewing a dispatch application.');
    }

    const application = await loadDispatchApplication(applicationId);
    if (!application) {
      fail(404, 'The selected dispatch application could not be found.');
    }

    const currentStatus = sanitizeText(application.status, DISPATCH_APPLICATION_STATUS.PENDING);
    if (decision === 'approve' && currentStatus === DISPATCH_APPLICATION_STATUS.APPROVED) {
      return json(200, {
        data: {
          approvedByUid: sanitizeOptionalText(application.approvedByUid),
          applicationId,
          decision,
          role: 'dispatch',
          tokenRefreshRequired: true,
        },
      });
    }
    if (decision === 'reject' && currentStatus === DISPATCH_APPLICATION_STATUS.REJECTED) {
      return json(200, {
        data: {
          approvedByUid: sanitizeOptionalText(application.approvedByUid),
          applicationId,
          decision,
          role: 'customer',
          tokenRefreshRequired: false,
        },
      });
    }
    if (currentStatus !== DISPATCH_APPLICATION_STATUS.PENDING) {
      fail(412, `This dispatch application has already been reviewed as ${currentStatus}.`);
    }

    const reviewedAt = nowIso();
    if (decision === 'approve') {
      await syncUserRoleState(applicationId, 'dispatch', context.uid, {
        accountDisabled: false,
        disabledAt: null,
        disabledByUid: null,
        lastPrivilegedRole: 'dispatch',
      });
      await updateUserAccount(applicationId, {
        dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.APPROVED,
        dispatchApplicationReviewedAt: reviewedAt,
        dispatchApplicationRejectionReason: null,
        displayName: sanitizeText(application.displayName, application.email.split('@')[0]),
        phoneNumber: sanitizeText(application.phoneNumber),
        updatedAt: reviewedAt,
      });
      const { error: riderError } = await serviceClient.from('DispatchRiderRecord').upsert(
        {
          id: applicationId,
          displayName: sanitizeText(application.displayName, 'Dispatch rider'),
          status: DEFAULT_DISPATCH_STATUS,
          zone: sanitizeText(application.region),
          vehicleType: sanitizeText(application.vehicleType, DEFAULT_DISPATCH_VEHICLE),
          acceptanceRate: 100,
          activeLoad: 0,
          completedTrips: 0,
          latitude: parseNumber(application.latitude, DEFAULT_NIGERIA_COORDINATE.latitude),
          longitude: parseNumber(application.longitude, DEFAULT_NIGERIA_COORDINATE.longitude),
          updatedAt: reviewedAt,
        },
        { onConflict: 'id' }
      );

      if (riderError) {
        throw new Error(riderError.message);
      }

      const { error: applicationError } = await serviceClient
        .from('DispatchApplicationRecord')
        .update({
          approvedByUid: context.uid,
          rejectionReason: null,
          reviewedAt,
          status: DISPATCH_APPLICATION_STATUS.APPROVED,
          updatedAt: reviewedAt,
        })
        .eq('id', applicationId);

      if (applicationError) {
        throw new Error(applicationError.message);
      }
    } else {
      const { error: applicationError } = await serviceClient
        .from('DispatchApplicationRecord')
        .update({
          approvedByUid: context.uid,
          rejectionReason: rejectionReason ?? 'Application rejected by admin review.',
          reviewedAt,
          status: DISPATCH_APPLICATION_STATUS.REJECTED,
          updatedAt: reviewedAt,
        })
        .eq('id', applicationId);

      if (applicationError) {
        throw new Error(applicationError.message);
      }

      await updateUserAccount(applicationId, {
        dispatchApplicationStatus: DISPATCH_APPLICATION_STATUS.REJECTED,
        dispatchApplicationReviewedAt: reviewedAt,
        dispatchApplicationRejectionReason: rejectionReason ?? 'Application rejected by admin review.',
        updatedAt: reviewedAt,
      });
    }

    await createAuditEntry(
      context.uid,
      decision === 'approve' ? 'dispatch_application_approved' : 'dispatch_application_rejected',
      'dispatch_application',
      applicationId,
      {
        rejectionReason: rejectionReason ?? null,
        vehicleType: sanitizeText(application.vehicleType),
      }
    );
    await notifyUsers([applicationId], {
      title:
        decision === 'approve' ? 'Dispatch application approved' : 'Dispatch application update',
      body:
        decision === 'approve'
          ? 'Your dispatch application was approved. Sign in to access the dispatch workspace.'
          : rejectionReason ?? 'Your dispatch application was rejected by admin review.',
      data: buildNotificationData({
        app: 'dispatch',
        routeKey: decision === 'approve' ? 'dispatch_profile' : 'dispatch_login',
        status: decision === 'approve' ? DISPATCH_APPLICATION_STATUS.APPROVED : DISPATCH_APPLICATION_STATUS.REJECTED,
        type: 'application_reviewed',
      }),
    });

    return json(200, {
      data: {
        approvedByUid: decision === 'approve' ? context.uid : null,
        applicationId,
        decision,
        role: decision === 'approve' ? 'dispatch' : 'customer',
        tokenRefreshRequired: decision === 'approve',
      },
    });
  }

  if (action === 'adminReviewPartnerApplication') {
    ensureRole(context.role, ['admin']);
    const applicationId = sanitizeText(data.applicationId);
    const decision = sanitizeText(data.decision);
    const rejectionReason = sanitizeOptionalText(data.rejectionReason);

    if (!applicationId) {
      fail(400, 'A partner application id is required.');
    }
    if (!['approve', 'reject'].includes(decision)) {
      fail(400, 'Use approve or reject when reviewing a partner application.');
    }

    const application = await loadPartnerApplication(applicationId);
    if (!application) {
      fail(404, 'The selected partner application could not be found.');
    }

    const currentStatus = sanitizeText(application.status, PARTNER_APPLICATION_STATUS.PENDING);
    if (decision === 'approve' && currentStatus === PARTNER_APPLICATION_STATUS.APPROVED) {
      return json(200, {
        data: {
          applicationId,
          approvedByUid: sanitizeOptionalText(application.approvedByUid),
          decision,
          restaurantId: sanitizeOptionalText(application.restaurantId),
          role: 'restaurant',
          tokenRefreshRequired: true,
        },
      });
    }
    if (decision === 'reject' && currentStatus === PARTNER_APPLICATION_STATUS.REJECTED) {
      return json(200, {
        data: {
          applicationId,
          approvedByUid: sanitizeOptionalText(application.approvedByUid),
          decision,
          restaurantId: sanitizeOptionalText(application.restaurantId),
          role: 'customer',
          tokenRefreshRequired: false,
        },
      });
    }
    if (currentStatus !== PARTNER_APPLICATION_STATUS.PENDING) {
      fail(412, `This partner application has already been reviewed as ${currentStatus}.`);
    }

    const reviewedAt = nowIso();
    let restaurantId: string | null = null;
    if (decision === 'approve') {
      restaurantId = sanitizeText(application.restaurantId) || crypto.randomUUID();
      await syncUserRoleState(applicationId, 'restaurant', context.uid, {
        accountDisabled: false,
        disabledAt: null,
        disabledByUid: null,
        lastPrivilegedRole: 'restaurant',
        restaurantId,
        restaurantLinkedAt: reviewedAt,
        restaurantLinkSource: 'partner_application_approved',
        restaurantName: sanitizeText(application.restaurantName, 'Restaurant'),
      });
      await updateUserAccount(applicationId, {
        displayName: sanitizeText(application.contactName, application.email.split('@')[0]),
        phoneNumber: sanitizeText(application.phoneNumber),
        partnerApplicationStatus: PARTNER_APPLICATION_STATUS.APPROVED,
        partnerApplicationReviewedAt: reviewedAt,
        partnerApplicationRejectionReason: null,
        updatedAt: reviewedAt,
      });

      const { error: restaurantError } = await serviceClient.from('RestaurantRecord').upsert(
        {
          id: restaurantId,
          ownerId: applicationId,
          name: sanitizeText(application.restaurantName, 'Restaurant'),
          nameKey: buildNameKey(sanitizeText(application.restaurantName, 'Restaurant')),
          cuisine: sanitizeOptionalText(application.cuisine),
          address: sanitizeOptionalText(application.address),
          description: sanitizeOptionalText(application.description) ?? '',
          image: '',
          logoImage: sanitizeOptionalText(application.logoImage) ?? '',
          menu: [],
          deliveryFee: 0,
          deliveryRadiusKm: 12,
          deliveryTime: sanitizeOptionalText(application.deliveryTime) ?? DEFAULT_DELIVERY_TIME,
          latitude: application.latitude ?? null,
          longitude: application.longitude ?? null,
          minOrder: 0,
          supportsDelivery: true,
          supportsPickup: true,
          isOpen: true,
          isPublished: false,
          updatedAt: reviewedAt,
        },
        { onConflict: 'id' }
      );

      if (restaurantError) {
        throw new Error(restaurantError.message);
      }

      const { error: approvalError } = await serviceClient.from('RestaurantApproval').upsert(
        {
          restaurantId,
          status: 'pending',
          approvedByUid: null,
          approvedAt: null,
          updatedAt: reviewedAt,
        },
        { onConflict: 'restaurantId' }
      );

      if (approvalError) {
        throw new Error(approvalError.message);
      }

      const { error: applicationError } = await serviceClient
        .from('PartnerApplicationRecord')
        .update({
          approvedByUid: context.uid,
          rejectionReason: null,
          reviewedAt,
          restaurantId,
          status: PARTNER_APPLICATION_STATUS.APPROVED,
          updatedAt: reviewedAt,
        })
        .eq('id', applicationId);

      if (applicationError) {
        throw new Error(applicationError.message);
      }
    } else {
      const { error: applicationError } = await serviceClient
        .from('PartnerApplicationRecord')
        .update({
          approvedByUid: context.uid,
          rejectionReason: rejectionReason ?? 'Partner application rejected by admin review.',
          reviewedAt,
          status: PARTNER_APPLICATION_STATUS.REJECTED,
          updatedAt: reviewedAt,
        })
        .eq('id', applicationId);

      if (applicationError) {
        throw new Error(applicationError.message);
      }

      await updateUserAccount(applicationId, {
        partnerApplicationStatus: PARTNER_APPLICATION_STATUS.REJECTED,
        partnerApplicationReviewedAt: reviewedAt,
        partnerApplicationRejectionReason: rejectionReason ?? 'Partner application rejected by admin review.',
        updatedAt: reviewedAt,
      });
    }

    await createAuditEntry(
      context.uid,
      decision === 'approve' ? 'partner_application_approved' : 'partner_application_rejected',
      'partner_application',
      applicationId,
      {
        rejectionReason: rejectionReason ?? null,
        restaurantId,
      }
    );
    await notifyUsers([applicationId], {
      title: decision === 'approve' ? 'Partner application approved' : 'Partner application update',
      body:
        decision === 'approve'
          ? 'Your partner application was approved. Sign in to complete your restaurant setup.'
          : rejectionReason ?? 'Your partner application was rejected by admin review.',
      data: buildNotificationData({
        app: 'partner',
        restaurantId,
        routeKey: decision === 'approve' ? 'partner_profile' : 'partner_login',
        status: decision === 'approve' ? PARTNER_APPLICATION_STATUS.APPROVED : PARTNER_APPLICATION_STATUS.REJECTED,
        type: 'application_reviewed',
      }),
    });

    return json(200, {
      data: {
        applicationId,
        approvedByUid: decision === 'approve' ? context.uid : null,
        decision,
        restaurantId,
        role: decision === 'approve' ? 'restaurant' : 'customer',
        tokenRefreshRequired: decision === 'approve',
      },
    });
  }

  if (action === 'customerGetOrders') {
    ensureRole(context.role, ['customer', 'admin']);
    const targetCustomerId = context.role === 'admin' ? sanitizeText(data.customerId, context.uid) : context.uid;
    const orders = await loadOrdersForCustomer(targetCustomerId);
    return json(200, { data: { orders } });
  }

  if (action === 'customerGetOrderDetail') {
    ensureRole(context.role, ['customer', 'admin']);
    const orderId = sanitizeText(data.orderId);
    if (!orderId) {
      fail(400, 'An order id is required.');
    }

    const bundle = await loadOrderBundle(orderId);
    if (!bundle) {
      fail(404, 'The selected order could not be found.');
    }

    if (context.role !== 'admin' && sanitizeText(bundle.order.customerId) !== context.uid) {
      fail(403, 'You can only view your own orders.');
    }

    const courierPhone = await loadDispatchRiderPhoneNumber(bundle.assignment?.courierId);

    return json(200, {
      data: {
        order: toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment, [], {
          courierPhone,
        }),
      },
    });
  }

  if (action === 'customerListFavoriteRestaurants') {
    ensureRole(context.role, ['customer', 'admin']);
    const targetCustomerId = context.role === 'admin' ? sanitizeText(data.customerId, context.uid) : context.uid;
    const restaurantIds = await loadFavoriteRestaurantIds(targetCustomerId);
    return json(200, { data: { restaurantIds } });
  }

  if (action === 'customerToggleFavoriteRestaurant') {
    ensureRole(context.role, ['customer', 'admin']);
    const restaurantId = sanitizeText(data.restaurantId);
    const requestedFavoriteState =
      typeof data.isFavorite === 'boolean' ? data.isFavorite : null;

    if (!restaurantId) {
      fail(400, 'A restaurant id is required.');
    }

    const { restaurant, approval } = await loadRestaurantById(restaurantId);
    if (!restaurant || restaurant.isPublished !== true || approval?.status !== 'approved') {
      fail(404, 'This restaurant is not available for favorites.');
    }

    const customerId = context.role === 'admin' ? sanitizeText(data.customerId, context.uid) : context.uid;
    const favoriteIds = new Set(await loadFavoriteRestaurantIds(customerId));
    const isCurrentlyFavorite = favoriteIds.has(restaurantId);
    const shouldBeFavorite = requestedFavoriteState ?? !isCurrentlyFavorite;

    if (shouldBeFavorite && !isCurrentlyFavorite) {
      const now = nowIso();
      const { error } = await serviceClient.from('CustomerFavoriteRestaurant').upsert(
        {
          id: `${customerId}_${restaurantId}`,
          customerId,
          restaurantId,
          createdAt: now,
          updatedAt: now,
        },
        { onConflict: 'customerId,restaurantId' }
      );

      if (error) {
        throw new Error(error.message);
      }
    }

    if (!shouldBeFavorite && isCurrentlyFavorite) {
      const { error } = await serviceClient
        .from('CustomerFavoriteRestaurant')
        .delete()
        .eq('customerId', customerId)
        .eq('restaurantId', restaurantId);

      if (error) {
        throw new Error(error.message);
      }
    }

    const restaurantIds = await loadFavoriteRestaurantIds(customerId);
    return json(200, {
      data: {
        isFavorite: shouldBeFavorite,
        restaurantId,
        restaurantIds,
      },
    });
  }

  if (action === 'placeCustomerOrder') {
    ensureRole(context.role, ['customer']);
    const orderDraft = await prepareCustomerOrderDraft(data, ['cash']);
    const idempotencyKey = orderDraft.idempotencyKey
      ? `${context.uid}:place_customer_order:${orderDraft.idempotencyKey}`
      : null;

    if (idempotencyKey) {
      const existing = await getIdempotencyRecord(idempotencyKey);
      if (existing?.response) {
        return json(200, { data: existing.response });
      }
    }

    const orderId = crypto.randomUUID();
    const payment = buildInitialPaymentSummary({
      paymentMethod: orderDraft.paymentMethod,
      settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
    });

    await createOrderWithItems({
      customerId: context.uid,
      deliveryLocation: orderDraft.deliveryLocation,
      fulfillmentType: orderDraft.fulfillmentType,
      items: orderDraft.items,
      orderId,
      payment,
      pricing: orderDraft.pricing,
      restaurantId: orderDraft.restaurantId,
      restaurantName: sanitizeText(orderDraft.restaurant.name, 'Restaurant'),
    });

    await insertDeliveryEvent({
      orderId,
      eventType: 'order_placed',
      actorUid: context.uid,
      details: {
        fulfillmentType: orderDraft.fulfillmentType,
        paymentMethod: orderDraft.paymentMethod,
        total: orderDraft.pricing.total,
      },
    });

    const response = {
      orderId,
      paymentStatus: sanitizeText(payment.status, PAYMENT_STATUS.PENDING),
      status: ORDER_STATUS.PLACED,
      total: orderDraft.pricing.total,
    };

    if (idempotencyKey) {
      await storeIdempotencyRecord(idempotencyKey, 'place_customer_order', context.uid, response);
    }

    await notifyRestaurantUsers(orderDraft.restaurantId, {
      title: 'New cash order',
      body: `Order ${orderId.slice(-6).toUpperCase()} is waiting for restaurant confirmation.`,
      data: buildNotificationData({
        app: 'partner',
        orderId,
        routeKey: 'partner_order_detail',
        type: 'order_update',
      }),
    });

    return json(200, { data: response });
  }

  if (action === 'initializeCustomerPayment') {
    ensureRole(context.role, ['customer']);
    assertPaystackConfigured();

    const orderDraft = await prepareCustomerOrderDraft(data, ['card', 'bank_transfer']);
    if (!PAYSTACK_PAYMENT_METHODS.has(orderDraft.paymentMethod)) {
      fail(412, 'Only card and bank transfer are supported for Paystack checkout.');
    }

    const idempotencyKey = orderDraft.idempotencyKey
      ? `${context.uid}:initialize_customer_payment:${orderDraft.idempotencyKey}`
      : null;

    if (idempotencyKey) {
      const existing = await getIdempotencyRecord(idempotencyKey);
      if (existing?.response) {
        return json(200, { data: existing.response });
      }
    }

    const orderId = crypto.randomUUID();
    const paymentReference = buildPaystackReference(orderId, orderDraft.paymentMethod);
    const initialPayment = buildInitialPaymentSummary({
      paymentMethod: orderDraft.paymentMethod,
      reference: paymentReference,
      settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
    });

    await createOrderWithItems({
      customerId: context.uid,
      deliveryLocation: orderDraft.deliveryLocation,
      fulfillmentType: orderDraft.fulfillmentType,
      items: orderDraft.items,
      orderId,
      payment: initialPayment,
      pricing: orderDraft.pricing,
      restaurantId: orderDraft.restaurantId,
      restaurantName: sanitizeText(orderDraft.restaurant.name, 'Restaurant'),
    });

    await upsertPaymentTransaction({
      orderId,
      customerId: context.uid,
      restaurantId: orderDraft.restaurantId,
      provider: PAYMENT_PROVIDER_PAYSTACK,
      method: orderDraft.paymentMethod,
      reference: paymentReference,
      currency: DEFAULT_CURRENCY,
      amount: orderDraft.pricing.total,
      status: PAYMENT_STATUS.PENDING,
    });

    try {
      const initializedTransaction = await initializePaystackTransaction({
        amount: orderDraft.pricing.total,
        email: context.email,
        paymentMethod: orderDraft.paymentMethod,
        reference: paymentReference,
        metadata: {
          customerId: context.uid,
          fulfillmentType: orderDraft.fulfillmentType,
          orderId,
          paymentMethod: orderDraft.paymentMethod,
          restaurantId: orderDraft.restaurantId,
          source: 'ebuy_customer_checkout',
        },
        callbackUrl: getPaystackCallbackUrl(),
      });

      const paymentWithAuthorization = buildInitialPaymentSummary({
        paymentMethod: orderDraft.paymentMethod,
        reference: paymentReference,
        accessCode: sanitizeOptionalText(initializedTransaction.access_code),
        authorizationUrl: sanitizeOptionalText(initializedTransaction.authorization_url),
        settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
      });

      await updateOrderRecord(orderId, {
        payment: paymentWithAuthorization,
        updatedAt: nowIso(),
      });

      await upsertPaymentTransaction({
        orderId,
        customerId: context.uid,
        restaurantId: orderDraft.restaurantId,
        provider: PAYMENT_PROVIDER_PAYSTACK,
        method: orderDraft.paymentMethod,
        reference: paymentReference,
        currency: DEFAULT_CURRENCY,
        amount: orderDraft.pricing.total,
        status: PAYMENT_STATUS.PENDING,
        accessCode: sanitizeOptionalText(initializedTransaction.access_code),
        authorizationUrl: sanitizeOptionalText(initializedTransaction.authorization_url),
        initializeResponse: initializedTransaction,
      });

      await insertDeliveryEvent({
        orderId,
        eventType: 'payment_initialized',
        actorUid: context.uid,
        details: {
          paymentMethod: orderDraft.paymentMethod,
          provider: PAYMENT_PROVIDER_PAYSTACK,
          reference: paymentReference,
        },
      });

      const response = {
        accessCode: sanitizeOptionalText(initializedTransaction.access_code),
        authorizationUrl: sanitizeText(initializedTransaction.authorization_url),
        orderId,
        paymentStatus: PAYMENT_STATUS.PENDING,
        publicKeyPresent: Boolean(getPaystackPublicKey()),
        reference: paymentReference,
        status: ORDER_STATUS.PLACED,
        total: orderDraft.pricing.total,
      };

      if (idempotencyKey) {
        await storeIdempotencyRecord(
          idempotencyKey,
          'initialize_customer_payment',
          context.uid,
          response
        );
      }

      return json(200, { data: response });
    } catch (paymentError) {
      const failedPayment = {
        ...initialPayment,
        lastEvent: 'paystack_initialize_failed',
        processor: PAYMENT_PROVIDER_PAYSTACK,
        status: PAYMENT_STATUS.FAILED,
        verifiedAt: nowIso(),
      };

      await updateOrderRecord(orderId, {
        payment: failedPayment,
        updatedAt: nowIso(),
      });

      await upsertPaymentTransaction({
        orderId,
        customerId: context.uid,
        restaurantId: orderDraft.restaurantId,
        provider: PAYMENT_PROVIDER_PAYSTACK,
        method: orderDraft.paymentMethod,
        reference: paymentReference,
        currency: DEFAULT_CURRENCY,
        amount: orderDraft.pricing.total,
        status: PAYMENT_STATUS.FAILED,
        lastError: paymentError instanceof Error ? paymentError.message : String(paymentError),
        failedAt: nowIso(),
      });

      throw paymentError;
    }
  }

  if (action === 'refreshCustomerPaymentStatus') {
    ensureRole(context.role, ['customer', 'admin']);
    const orderId = sanitizeText(data.orderId);
    if (!orderId) {
      fail(400, 'An order id is required.');
    }

    const bundle = await loadOrderBundle(orderId);
    if (!bundle) {
      fail(404, 'The selected order could not be found.');
    }

    if (context.role !== 'admin' && sanitizeText(bundle.order.customerId) !== context.uid) {
      fail(403, 'You can only refresh payment status for your own orders.');
    }

    if (!PAYSTACK_PAYMENT_METHODS.has(sanitizeText(bundle.order.payment?.method))) {
      return json(200, {
        data: {
          gatewayStatus: sanitizeText(bundle.order.payment?.lastEvent, 'cash_order'),
          orderId,
          paymentStatus: sanitizeText(bundle.order.payment?.status, PAYMENT_STATUS.PENDING),
          status: sanitizeText(bundle.order.status, ORDER_STATUS.PLACED),
        },
      });
    }

    const nextPayment = await refreshPaystackPaymentForOrder(bundle.order);
    return json(200, {
      data: {
        gatewayStatus: sanitizeText(nextPayment.lastEvent, 'verification_complete'),
        orderId,
        paymentStatus: sanitizeText(nextPayment.status, PAYMENT_STATUS.PENDING),
        status: sanitizeText(bundle.order.status, ORDER_STATUS.PLACED),
      },
    });
  }

  if (action === 'cancelCustomerOrder') {
    ensureRole(context.role, ['customer', 'admin']);
    const orderId = sanitizeText(data.orderId);
    if (!orderId) {
      fail(400, 'An order id is required.');
    }

    const bundle = await loadOrderBundle(orderId);
    if (!bundle) {
      fail(404, 'The selected order could not be found.');
    }

    if (context.role !== 'admin' && bundle.order.customerId !== context.uid) {
      fail(403, 'You can only cancel your own orders.');
    }

    const currentStatus = normalizeOrderStatus(bundle.order.status);
    if (![ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
      fail(412, 'This order can no longer be cancelled.');
    }

    const refundRate = getCustomerCancellationRefundRate(currentStatus);
    const payment = buildRefundUpdate({
      order: bundle.order,
      refundRate,
      reason:
        refundRate === 1 ? 'customer_cancelled_full_refund' : 'customer_cancelled_partial_refund',
    });
    const timeline = {
      ...(bundle.order.timeline ?? {}),
      cancelledAt: nowIso(),
    };
    const cancellation = {
      actor: context.role === 'admin' ? 'admin' : 'customer',
      refundRate,
    };

    await updateOrderRecord(orderId, {
      cancellation,
      payment,
      status: ORDER_STATUS.CANCELLED,
      timeline,
      updatedAt: nowIso(),
    });

    await insertDeliveryEvent({
      orderId,
      eventType: 'order_cancelled',
      actorUid: context.uid,
      details: {
        actorRole: context.role,
        refundRate,
      },
    });
    await notifyRestaurantUsers(bundle.order.restaurantId, {
      title: 'Order cancelled',
      body: `Order ${orderId.slice(-6).toUpperCase()} was cancelled by ${context.role}.`,
      data: buildNotificationData({
        app: 'partner',
        orderId,
        routeKey: 'partner_order_detail',
        status: ORDER_STATUS.CANCELLED,
        type: 'order_update',
      }),
    });
    if (sanitizeText(bundle.assignment?.courierId)) {
      await notifyUsers([sanitizeText(bundle.assignment?.courierId)], {
        title: 'Delivery cancelled',
        body: `Order ${orderId.slice(-6).toUpperCase()} no longer requires delivery.`,
        data: buildNotificationData({
          app: 'dispatch',
          orderId,
          routeKey: 'dispatch_delivery_detail',
          status: ORDER_STATUS.CANCELLED,
          type: 'order_update',
        }),
      });
    }

    return json(200, {
      data: {
        orderId,
        refundRate,
        status: ORDER_STATUS.CANCELLED,
      },
    });
  }

  if (action === 'partnerGetRestaurantContext') {
    ensureRole(context.role, ['restaurant', 'admin']);
    const userAccount = await loadUserAccount(context.uid);
    const linkedRestaurantId = sanitizeText(userAccount?.restaurantId);
    const [managedRestaurant, allRestaurants] = await Promise.all([
      loadManagedRestaurantForUser(context.uid, context.role),
      serviceClient
        .from('RestaurantRecord')
        .select(
          'id,ownerId,name,nameKey,cuisine,address,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,createdAt,updatedAt'
        )
        .order('updatedAt', { ascending: false }),
    ]);

    if (allRestaurants.error) {
      throw new Error(allRestaurants.error.message);
    }

    const restaurantRows = (allRestaurants.data ?? []) as RestaurantRecordRow[];
    const approvals = await Promise.all(restaurantRows.map((restaurant) => loadRestaurantById(restaurant.id)));
    const allResponses = approvals
      .map((entry) => (entry.restaurant ? buildRestaurantResponse(entry.restaurant, entry.approval) : null))
      .filter(Boolean);
    const restaurantResponse = managedRestaurant.restaurant
      ? buildRestaurantResponse(managedRestaurant.restaurant, managedRestaurant.approval)
      : null;
    const claimableRestaurants = allResponses.filter((restaurant) => {
      const candidate = restaurant as ReturnType<typeof buildRestaurantResponse>;
      return !candidate.ownerId || candidate.ownerId === context.uid || candidate.id === managedRestaurant.restaurant?.id;
    });

    return json(200, {
      data: {
        claimableRestaurants,
        requiresVerifiedLink: Boolean(
          restaurantResponse && linkedRestaurantId && linkedRestaurantId !== restaurantResponse.id
        ),
        restaurant: restaurantResponse,
        restaurants: allResponses,
      },
    });
  }

  if (action === 'partnerGetRestaurantOrders') {
    ensureRole(context.role, ['restaurant', 'admin']);
    const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);
    if (!managedRestaurant.restaurant) {
      return json(200, {
        data: {
          orders: [],
          restaurant: null,
        },
      });
    }

    const { data: orders, error } = await serviceClient
      .from('CustomerOrder')
      .select(
        'id,customerId,restaurantId,restaurantName,status,fulfillmentType,pricing,payment,deliveryAddress,deliveryLocation,cancellation,timeline,createdAt,updatedAt'
      )
      .eq('restaurantId', managedRestaurant.restaurant.id)
      .order('createdAt', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const orderList = sortPartnerKitchenQueue(((orders ?? []) as CustomerOrderRow[]).filter(isOrderOperationallyVisible));
    const { assignmentsByOrderId, itemsByOrderId } = await loadOrderRelations(orderList.map((order) => order.id));

    return json(200, {
      data: {
        orders: orderList.map((order) =>
          toOrderSnapshotResponse(
            order,
            itemsByOrderId.get(order.id) ?? [],
            assignmentsByOrderId.get(order.id) ?? null
          )
        ),
        restaurant: buildRestaurantResponse(managedRestaurant.restaurant, managedRestaurant.approval),
      },
    });
  }

  if (action === 'partnerGetRestaurantOrder') {
    ensureRole(context.role, ['restaurant', 'admin']);
    const orderId = sanitizeText(data.orderId);
    if (!orderId) {
      fail(400, 'An order id is required.');
    }

    const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);
    const bundle = await loadOrderBundle(orderId);
    if (!bundle) {
      fail(404, 'The selected order could not be found.');
    }

    if (!managedRestaurant.restaurant || managedRestaurant.restaurant.id !== bundle.order.restaurantId) {
      fail(403, 'This order does not belong to your restaurant profile.');
    }

    assertOrderPaymentReadyForOperations(bundle.order);

    return json(200, {
      data: {
        order: toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment),
      },
    });
  }

  if (action === 'upsertPartnerRestaurantProfile') {
    ensureRole(context.role, ['restaurant', 'admin']);
    const requestedRestaurantId = sanitizeText(data.restaurantId);
    const userAccount = await loadUserAccount(context.uid);
    const linkedRestaurantId = sanitizeText(userAccount?.restaurantId);
    const isAdmin = context.role === 'admin';

    let currentRestaurant: RestaurantRecordRow | null = null;
    let restaurantId = requestedRestaurantId || linkedRestaurantId || crypto.randomUUID();

    if (requestedRestaurantId || linkedRestaurantId) {
      const existingRestaurant = await loadRestaurantById(restaurantId);
      currentRestaurant = existingRestaurant.restaurant;
      if (!currentRestaurant) {
        fail(404, 'The selected restaurant could not be found.');
      }

      const existingOwnerId = sanitizeText(currentRestaurant.ownerId);
      if (existingOwnerId && existingOwnerId !== context.uid && !isAdmin) {
        fail(403, 'This restaurant is already managed by another partner account.');
      }
    }

    const profile = buildPartnerRestaurantPayload(data, context.uid, {
      allowPublish: isAdmin,
      existingPublished: currentRestaurant?.isPublished === true,
    });

    const savedAt = nowIso();
    const { error } = await serviceClient.from('RestaurantRecord').upsert(
      {
        id: restaurantId,
        ownerId: context.uid,
        name: profile.name,
        nameKey: profile.nameKey,
        cuisine: profile.cuisine,
        address: profile.address,
        description: profile.description,
        image: profile.image,
        logoImage: profile.logoImage,
        deliveryFee: profile.deliveryFee,
        deliveryRadiusKm: profile.deliveryRadiusKm,
        deliveryTime: profile.deliveryTime,
        openingTime: profile.openingTime,
        closingTime: profile.closingTime,
        latitude: profile.latitude,
        longitude: profile.longitude,
        minOrder: profile.minOrder,
        supportsDelivery: profile.supportsDelivery,
        supportsPickup: profile.supportsPickup,
        isOpen: profile.isOpen,
        isPublished: profile.isPublished,
        createdAt: currentRestaurant?.createdAt ?? savedAt,
        updatedAt: savedAt,
      },
      { onConflict: 'id' }
    );

    if (error) {
      throw new Error(error.message);
    }

    await updateUserAccount(context.uid, {
      restaurantId,
      restaurantLinkedAt: savedAt,
      restaurantLinkSource: currentRestaurant ? 'partner_update' : 'partner_create',
      restaurantName: profile.name,
      updatedAt: savedAt,
    });

    await upsertUserRoleLink(context.uid, context.role, restaurantId, isAdmin ? context.uid : null);
    await createAuditEntry(
      context.uid,
      currentRestaurant ? 'restaurant_profile_updated' : 'restaurant_profile_created',
      'restaurant',
      restaurantId,
      { isAdmin }
    );

    return json(200, {
      data: {
        id: restaurantId,
        name: profile.name,
      },
    });
  }

  if (action === 'claimPartnerRestaurantLink') {
    ensureRole(context.role, ['restaurant', 'admin']);
    const restaurantId = sanitizeText(data.restaurantId);
    if (!restaurantId) {
      fail(400, 'A restaurant id is required.');
    }

    const existingRestaurant = await loadRestaurantById(restaurantId);
    if (!existingRestaurant.restaurant) {
      fail(404, 'The selected restaurant could not be found.');
    }

    const existingOwnerId = sanitizeText(existingRestaurant.restaurant.ownerId);
    if (existingOwnerId && existingOwnerId !== context.uid && context.role !== 'admin') {
      fail(403, 'This restaurant is already managed by another partner account.');
    }

    const linkedAt = nowIso();
    const { error: restaurantError } = await serviceClient
      .from('RestaurantRecord')
      .update({
        ownerId: context.uid,
        updatedAt: linkedAt,
      })
      .eq('id', restaurantId);

    if (restaurantError) {
      throw new Error(restaurantError.message);
    }

    await updateUserAccount(context.uid, {
      restaurantId,
      restaurantLinkedAt: linkedAt,
      restaurantLinkSource: 'partner_claim',
      restaurantName: sanitizeText(existingRestaurant.restaurant.name, 'Restaurant'),
      updatedAt: linkedAt,
    });

    await upsertUserRoleLink(
      context.uid,
      context.role,
      restaurantId,
      context.role === 'admin' ? context.uid : null
    );
    await createAuditEntry(context.uid, 'restaurant_link_claimed', 'restaurant', restaurantId, {
      isAdmin: context.role === 'admin',
    });

    return json(200, {
      data: {
        id: restaurantId,
        name: sanitizeText(existingRestaurant.restaurant.name, 'Restaurant'),
      },
    });
  }

  if (action === 'upsertPartnerRestaurantMenu') {
    ensureRole(context.role, ['restaurant', 'admin']);
    const restaurantId = sanitizeText(data.restaurantId);
    if (!restaurantId) {
      fail(400, 'A restaurant id is required.');
    }

    const menu = normalizePartnerMenuInput(data.menu);
    const existingRestaurant = await loadRestaurantById(restaurantId);
    if (!existingRestaurant.restaurant) {
      fail(404, 'The selected restaurant could not be found.');
    }

    if (
      context.role !== 'admin' &&
      sanitizeText(existingRestaurant.restaurant.ownerId) !== context.uid
    ) {
      fail(403, 'You are not allowed to update this restaurant\'s menu.');
    }

    const { error } = await serviceClient
      .from('RestaurantRecord')
      .update({
        menu,
        updatedAt: nowIso(),
      })
      .eq('id', restaurantId);

    if (error) {
      throw new Error(error.message);
    }

    await createAuditEntry(context.uid, 'partner_menu_upserted', 'restaurant', restaurantId, {
      categories: menu.length,
      items: menu.reduce((sum, category) => sum + category.items.length, 0),
    });

    return json(200, {
      data: {
        categories: menu.length,
        items: menu.reduce((sum, category) => sum + category.items.length, 0),
        restaurantId,
      },
    });
  }

  if (action === 'partnerUpdateOrderStatus') {
    ensureRole(context.role, ['restaurant', 'admin']);
    const orderId = sanitizeText(data.orderId);
    const nextAction = sanitizeText(data.action);
    if (!orderId) {
      fail(400, 'An order id is required.');
    }

    const managedRestaurant = await loadManagedRestaurantForUser(context.uid, context.role);
    const bundle = await loadOrderBundle(orderId);
    if (!bundle) {
      fail(404, 'The selected order could not be found.');
    }

    if (!managedRestaurant.restaurant || managedRestaurant.restaurant.id !== bundle.order.restaurantId) {
      fail(403, 'This order does not belong to your restaurant profile.');
    }

    assertNonTerminalOrder(bundle.order);
    assertOrderPaymentReadyForOperations(bundle.order);

    const currentStatus = normalizeOrderStatus(bundle.order.status);
    const nextState = buildPartnerStatusUpdate(currentStatus, nextAction);
    const timeline = {
      ...(bundle.order.timeline ?? {}),
      ...nextState.timelinePatch,
    };

    await updateOrderRecord(orderId, {
      status: nextState.status,
      timeline,
      updatedAt: nowIso(),
    });

    await insertDeliveryEvent({
      orderId,
      eventType: `partner_${nextAction}`,
      actorUid: context.uid,
      details: {
        nextStatus: nextState.status,
      },
    });
    await notifyUsers([bundle.order.customerId], {
      title: 'Order update',
      body: `Order ${orderId.slice(-6).toUpperCase()} is now ${nextState.status.replace(/_/g, ' ')}.`,
      data: buildNotificationData({
        app: 'customer',
        orderId,
        routeKey: 'customer_order_detail',
        status: nextState.status,
        type: 'order_update',
      }),
    });
    if (
      nextState.status === ORDER_STATUS.READY_FOR_PICKUP &&
      sanitizeText(bundle.order.fulfillmentType, 'delivery') === 'delivery'
    ) {
      await notifyUsers(
        sanitizeText(bundle.assignment?.courierId) ? [sanitizeText(bundle.assignment?.courierId)] : [],
        {
          title: 'Pickup ready',
          body: `Order ${orderId.slice(-6).toUpperCase()} is ready for pickup.`,
          data: buildNotificationData({
            app: 'dispatch',
            orderId,
            routeKey: 'dispatch_delivery_detail',
            status: nextState.status,
            type: 'order_update',
          }),
        }
      );
    }

    return json(200, {
      data: {
        orderId,
        status: nextState.status,
      },
    });
  }

  if (action === 'dispatchGetDeliveryQueue') {
    ensureRole(context.role, ['dispatch', 'admin']);
    const { data: orders, error } = await serviceClient
      .from('CustomerOrder')
      .select(
        'id,customerId,restaurantId,restaurantName,status,fulfillmentType,pricing,payment,deliveryAddress,deliveryLocation,cancellation,timeline,createdAt,updatedAt'
      )
      .eq('fulfillmentType', 'delivery')
      .order('createdAt', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const orderList = ((orders ?? []) as CustomerOrderRow[]).filter(isOrderOperationallyVisible);
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

    return json(200, {
      data: {
        orders: sortedOrderList.map((order) =>
          toOrderSnapshotResponse(
            order,
            itemsByOrderId.get(order.id) ?? [],
            assignmentsByOrderId.get(order.id) ?? null
          )
        ),
      },
    });
  }

  if (action === 'dispatchGetRiders') {
    ensureRole(context.role, ['dispatch', 'admin']);
    const { data: riders, error } = await serviceClient
      .from('DispatchRiderRecord')
      .select(
        'id,displayName,status,zone,vehicleType,acceptanceRate,activeLoad,completedTrips,latitude,longitude,createdAt,updatedAt'
      )
      .order('updatedAt', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return json(200, {
      data: {
        riders: ((riders ?? []) as DispatchRiderRow[]).map((rider) => buildDispatchRiderResponse(rider)),
      },
    });
  }

  if (action === 'dispatchGetWeeklyEarnings') {
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
      .select(
        'id,customerId,restaurantId,restaurantName,status,fulfillmentType,pricing,payment,deliveryAddress,deliveryLocation,cancellation,timeline,createdAt,updatedAt'
      )
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
  }

  if (action === 'dispatchGetOrderDetail') {
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

    const customerPhone = await loadUserPhoneNumber(bundle.order.customerId);

    return json(200, {
      data: {
        order: toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment, bundle.events, {
          customerPhone,
        }),
      },
    });
  }

  if (action === 'upsertDispatchRiderProfile') {
    ensureRole(context.role, ['dispatch', 'admin']);
    const requestedRiderId = sanitizeText(data.riderId);
    const riderId = requestedRiderId || (context.role === 'dispatch' ? context.uid : crypto.randomUUID());
    const draft = normalizeDispatchRiderDraft(data);
    let persistedDraft = draft;

    if (context.role === 'dispatch') {
      if (riderId !== context.uid) {
        fail(403, 'Dispatch riders can only update their own rider profile.');
      }

      const { data: existingRider, error } = await serviceClient
        .from('DispatchRiderRecord')
        .select(
          'id,displayName,status,zone,vehicleType,acceptanceRate,activeLoad,completedTrips,latitude,longitude,createdAt,updatedAt'
        )
        .eq('id', riderId)
        .maybeSingle<DispatchRiderRow>();

      if (error) {
        throw new Error(error.message);
      }

      if (!existingRider) {
        fail(
          412,
          'Your rider profile must be provisioned by admin approval before you can update live dispatch status.'
        );
      }

      persistedDraft = {
        acceptanceRate: existingRider.acceptanceRate ?? null,
        activeLoad: existingRider.activeLoad ?? 0,
        completedTrips: existingRider.completedTrips ?? 0,
        currentAddress: null,
        displayName: existingRider.displayName,
        lga: draft.lga,
        latitude: draft.latitude,
        longitude: draft.longitude,
        phoneNumber: null,
        region: draft.region,
        status: draft.status,
        vehicleType: existingRider.vehicleType,
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
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { onConflict: 'id' }
    );

    if (error) {
      throw new Error(error.message);
    }

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
  }

  if (action === 'dispatchAssignOrderCourier') {
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

    const { data: courier, error: courierError } = await serviceClient
      .from('DispatchRiderRecord')
      .select(
        'id,displayName,status,zone,vehicleType,acceptanceRate,activeLoad,completedTrips,latitude,longitude,createdAt,updatedAt'
      )
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
    const wasReassigned = Boolean(
      sanitizeText(bundle.assignment?.courierId) && sanitizeText(bundle.assignment?.courierId) !== courier.id
    );

    const { error: assignmentError } = await serviceClient.from('DeliveryAssignment').upsert(
      {
        orderId,
        dispatchId: context.uid,
        courierId: courier.id,
        courierName,
        assignedAt,
        updatedAt: assignedAt,
      },
      { onConflict: 'orderId' }
    );

    if (assignmentError) {
      throw new Error(assignmentError.message);
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
  }

  if (action === 'dispatchUpdateOrderStatus') {
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
  }

  if (action === 'adminGetDashboardSnapshot') {
    ensureRole(context.role, ['admin']);
    const [usersResult, restaurantsResult, ordersResult, ridersResult] = await Promise.all([
      serviceClient
        .from('UserAccount')
        .select(
          'uid,email,displayName,phoneNumber,emailVerified,roleDisplay,partnerApplicationStatus,partnerApplicationReviewedAt,partnerApplicationRejectionReason,dispatchApplicationStatus,dispatchApplicationReviewedAt,dispatchApplicationRejectionReason,activeSessionId,activeSessionUpdatedAt,accountDisabled,disabledAt,disabledByUid,lastPrivilegedRole,restaurantId,restaurantName,restaurantLinkedAt,restaurantLinkSource,createdAt,updatedAt'
        )
        .order('createdAt', { ascending: false }),
      serviceClient
        .from('RestaurantRecord')
        .select(
          'id,ownerId,name,nameKey,cuisine,address,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,createdAt,updatedAt'
        )
        .order('updatedAt', { ascending: false }),
      serviceClient
        .from('CustomerOrder')
        .select(
          'id,customerId,restaurantId,restaurantName,status,fulfillmentType,pricing,payment,deliveryAddress,deliveryLocation,cancellation,timeline,createdAt,updatedAt'
        )
        .order('createdAt', { ascending: false }),
      serviceClient
        .from('DispatchRiderRecord')
        .select(
          'id,displayName,status,zone,vehicleType,acceptanceRate,activeLoad,completedTrips,latitude,longitude,createdAt,updatedAt'
        )
        .order('updatedAt', { ascending: false }),
    ]);

    if (usersResult.error || restaurantsResult.error || ordersResult.error || ridersResult.error) {
      throw new Error(
        usersResult.error?.message ??
          restaurantsResult.error?.message ??
          ordersResult.error?.message ??
          ridersResult.error?.message ??
          'Failed to load admin dashboard snapshot.'
      );
    }

    const users = (usersResult.data ?? []) as UserAccountRow[];
    const rolesByUserId = await loadUserRoles(users.map((user) => user.uid));
    const restaurants = (restaurantsResult.data ?? []) as RestaurantRecordRow[];
    const orders = (ordersResult.data ?? []) as CustomerOrderRow[];
    const riders = (ridersResult.data ?? []) as DispatchRiderRow[];
    const orderRelations = await loadOrderRelations(orders.map((order) => order.id));
    const restaurantApprovals = await Promise.all(restaurants.map((restaurant) => loadRestaurantById(restaurant.id)));

    return json(200, {
      data: {
        dispatchProfiles: riders.map((rider) => buildDispatchRiderResponse(rider)),
        orders: orders.map((order) =>
          toOrderSnapshotResponse(
            order,
            orderRelations.itemsByOrderId.get(order.id) ?? [],
            orderRelations.assignmentsByOrderId.get(order.id) ?? null
          )
        ),
        restaurants: restaurantApprovals
          .map((entry) => (entry.restaurant ? buildRestaurantResponse(entry.restaurant, entry.approval) : null))
          .filter(Boolean),
        users: users.map((user) => buildUserAccountResponse(user, rolesByUserId.get(user.uid) ?? [])),
      },
    });
  }

  if (action === 'adminGetAccessOverview') {
    ensureRole(context.role, ['admin']);
    const { data: users, error } = await serviceClient
      .from('UserAccount')
      .select(
        'uid,email,displayName,phoneNumber,emailVerified,roleDisplay,partnerApplicationStatus,partnerApplicationReviewedAt,partnerApplicationRejectionReason,dispatchApplicationStatus,dispatchApplicationReviewedAt,dispatchApplicationRejectionReason,activeSessionId,activeSessionUpdatedAt,accountDisabled,disabledAt,disabledByUid,lastPrivilegedRole,restaurantId,restaurantName,restaurantLinkedAt,restaurantLinkSource,createdAt,updatedAt'
      )
      .order('createdAt', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const userRows = (users ?? []) as UserAccountRow[];
    const rolesByUserId = await loadUserRoles(userRows.map((user) => user.uid));

    return json(200, {
      data: {
        users: userRows.map((user) => buildUserAccountResponse(user, rolesByUserId.get(user.uid) ?? [])),
      },
    });
  }

  return null;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
      status: 204,
    });
  }

  if (request.method !== 'POST') {
    return json(405, {
      error: {
        message: 'Use POST for app RPC requests.',
      },
    });
  }

  let payload: { action?: string; data?: Record<string, unknown> } = {};

  try {
    payload = (await request.json().catch(() => ({}))) as typeof payload;
    const action = sanitizeText(payload.action);

    if (!action) {
      return json(400, {
        error: {
          message: 'An RPC action is required.',
        },
      });
    }

    const nativeResponse = await handleNativeAction(action, request, payload.data ?? {});
    if (nativeResponse) {
      return nativeResponse;
    }

    return json(501, {
      error: {
        message: `The RPC action "${action}" is not implemented in the native Supabase backend.`,
      },
    });
  } catch (error) {
    const status =
      error instanceof RpcError
        ? error.status
        : error instanceof Error && error.message === 'Missing authorization header'
          ? 401
          : error instanceof Error && error.message === 'This account is disabled.'
            ? 403
            : 500;

    return json(status, {
      error: {
        message: error instanceof Error ? error.message : 'Unexpected Edge RPC failure.',
      },
    });
  }
});
