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
import {
  broadcastOrderChanged,
  broadcastPromosChanged,
  broadcastRestaurantsChanged,
  broadcastRidersChanged,
  broadcastSupportInboxChanged,
  broadcastSupportThreadChanged,
} from '../_shared/realtime.ts';
import { toCdnImageUrl } from '../_shared/media.ts';
import { resolveBroadcastAudience, type BroadcastSegment } from '../_shared/broadcast.ts';
import {
  buildTransactionalEmailHtml,
  formatNairaAmount,
  loadUserEmailRecipient,
  sendTransactionalEmail,
  shortOrderCode,
} from '../_shared/email.ts';
import {
  createEdgeObservation,
  finishEdgeObservation,
  jsonResponse,
  isEdgeBackpressureError,
  runWithBackpressure,
} from '../_shared/observability.ts';
import { validatePromoTrack } from './promoTrack.ts';

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
  dispatchOwnerId?: string | null;
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
  courierLatitude?: number | null;
  courierLongitude?: number | null;
  courierUpdatedAt?: string | null;
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
const CURRENT_TERMS_VERSION = '2026-05-31-v1';
const CURRENT_PRIVACY_VERSION = '2026-05-31-v1';
const POLICY_APPS = new Set(['customer', 'partner', 'dispatch']);
const POLICY_SOURCES = new Set([
  'customer_signup',
  'customer_policy_gate',
  'customer_google_gate',
  'partner_signup',
  'dispatch_signup',
]);
const HOT_WRITE_ACTIONS = new Set([
  'placeCustomerOrder',
  'initializeCustomerPayment',
  'refreshCustomerPaymentStatus',
  'cancelCustomerOrder',
]);
const HOT_WRITE_BACKPRESSURE_LIMITS: Record<string, number> = {
  cancelCustomerOrder: 8,
  initializeCustomerPayment: 8,
  placeCustomerOrder: 6,
  refreshCustomerPaymentStatus: 10,
};
const DEFAULT_FUNCTION_ORDER_STATUS = 'placed';
const DEFAULT_CURRENCY = 'NGN';
const DEFAULT_DELIVERY_TIME = '25-35 min';
const DEFAULT_DISPATCH_STATUS = 'Available';
const DEFAULT_DISPATCH_VEHICLE = 'Bike';
const PLATFORM_COMMISSION_RATES = {
  delivery: 0.15,
  pickup: 0.1,
} as const;
// Flat per-item marketplace markup charged to the customer on top of the
// restaurant's own menu price. Kept entirely by the platform — the restaurant is
// always settled on its own price (see calculateSettlementBreakdown).
// Mirrored on the client via CUSTOMER_ITEM_MARKUP in packages/domain/src/orders.ts.
const CUSTOMER_ITEM_MARKUP = 150;
const PAYMENT_PROVIDER_PAYSTACK = 'paystack';
const PAYMENT_PROVIDER_CASH = 'cash_on_delivery';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')?.trim() ?? '';
const ADMIN_REQUEST_TIMEOUT_MS = 10_000;
const PAYSTACK_REQUEST_TIMEOUT_MS = 10_000;
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
const ORDER_PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

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

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  jsonResponse(status, body, {
    ...corsHeaders,
    ...headers,
  });

const nowIso = () => new Date().toISOString();

const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const sanitizeOptionalText = (value: unknown) => {
  const nextValue = sanitizeText(value);
  return nextValue || null;
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const normalizePolicyApp = (value: unknown) => {
  const app = sanitizeText(value).toLowerCase();
  return POLICY_APPS.has(app) ? app : '';
};

const normalizePolicySource = (value: unknown, fallback: string) => {
  const source = sanitizeText(value, fallback);
  return POLICY_SOURCES.has(source) ? source : fallback;
};

const validatePolicyAcceptancePayload = (
  value: unknown,
  expectedApp: 'customer' | 'partner' | 'dispatch',
  fallbackSource: string
) => {
  const payload = typeof value === 'object' && value !== null ? (value as JsonObject) : {};
  const app = normalizePolicyApp(payload.app);
  const termsVersion = sanitizeText(payload.termsVersion);
  const privacyVersion = sanitizeText(payload.privacyVersion);

  if (payload.accepted !== true || app !== expectedApp) {
    fail(412, 'Accept the current Terms and Privacy Policy before continuing.');
  }

  if (termsVersion !== CURRENT_TERMS_VERSION || privacyVersion !== CURRENT_PRIVACY_VERSION) {
    fail(412, 'Accept the latest Terms and Privacy Policy before continuing.');
  }

  return {
    app,
    privacyVersion,
    source: normalizePolicySource(payload.source, fallbackSource),
    termsVersion,
  };
};

const recordPolicyAcceptance = async (
  uid: string,
  email: string,
  acceptance: {
    app: string;
    privacyVersion: string;
    source: string;
    termsVersion: string;
  }
) => {
  const acceptedAt = nowIso();
  const { error } = await serviceClient.from('UserPolicyAcceptance').upsert(
    {
      id: crypto.randomUUID(),
      userId: uid,
      email,
      app: acceptance.app,
      termsVersion: acceptance.termsVersion,
      privacyVersion: acceptance.privacyVersion,
      source: acceptance.source,
      acceptedAt,
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
    },
    {
      onConflict: 'userId,app,termsVersion,privacyVersion',
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return acceptedAt;
};

const hasCurrentPolicyAcceptance = async (uid: string, app: string) => {
  const { data, error } = await serviceClient
    .from('UserPolicyAcceptance')
    .select('id,acceptedAt')
    .eq('userId', uid)
    .eq('app', app)
    .eq('termsVersion', CURRENT_TERMS_VERSION)
    .eq('privacyVersion', CURRENT_PRIVACY_VERSION)
    .maybeSingle<{ acceptedAt?: string | null; id: string }>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    accepted: Boolean(data?.id),
    acceptedAt: data?.acceptedAt ?? null,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    termsVersion: CURRENT_TERMS_VERSION,
  };
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
    // 'confirmed' was written by the async order/payment handlers but is not a valid
    // order status; treat it as 'placed' so paid orders stay actionable.
    case 'confirmed':
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
        courierLatitude: options.courierLatitude ?? null,
        courierLongitude: options.courierLongitude ?? null,
        courierPhone: sanitizeOptionalText(options.courierPhone),
        courierUpdatedAt: options.courierUpdatedAt ?? null,
        dispatchId: sanitizeOptionalText(assignment.dispatchId),
        dispatchOwnerId: sanitizeOptionalText(assignment.dispatchOwnerId),
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
  status: normalizeOrderStatus(sanitizeText(order.status, DEFAULT_FUNCTION_ORDER_STATUS)),
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
  image: toCdnImageUrl(sanitizeOptionalText(restaurant.image)),
  logoImage: toCdnImageUrl(sanitizeOptionalText(restaurant.logoImage)),
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
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    fail(500, 'Supabase admin credentials are not configured for this Edge function.');
  }
};

const toSupabaseAdminHeaders = () => {
  assertSupabaseAdminConfigured();
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
};

const adminAuthRequest = async <T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  assertSupabaseAdminConfigured();
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        ...toSupabaseAdminHeaders(),
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      fail(504, `Supabase admin request timed out after ${ADMIN_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  }
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
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: toSupabaseAdminHeaders(),
      signal: AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      fail(504, `Supabase admin request timed out after ${ADMIN_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  }

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

const loadUserPhoneNumbers = async (uids: string[]) => {
  const phoneByUid = new Map<string, string | null>();
  const safeUids = unique(uids.map((uid) => sanitizeText(uid)).filter(Boolean));
  if (safeUids.length === 0) {
    return phoneByUid;
  }

  const { data, error } = await serviceClient
    .from('UserAccount')
    .select('uid,phoneNumber')
    .in('uid', safeUids);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as Pick<UserAccountRow, 'uid' | 'phoneNumber'>[]) {
    phoneByUid.set(row.uid, sanitizeOptionalText(row.phoneNumber));
  }

  return phoneByUid;
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

const loadDispatchRiderSnapshot = async (riderId: string | null | undefined) => {
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

type DispatchOwnerCandidate = {
  weight: number;
  userId: string;
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

const selectDispatchOwnerForRestaurant = async (restaurantId: string) => {
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

const toRadians = (value: number) => (value * Math.PI) / 180;

const getDistanceKm = (
  origin: { latitude: number; longitude: number },
  target: { latitude: number; longitude: number }
) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(target.latitude - origin.latitude);
  const dLon = toRadians(target.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(target.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const adjustDispatchRiderLoad = async (riderId: string | null | undefined, delta: number) => {
  const safeRiderId = sanitizeText(riderId);
  if (!safeRiderId || !Number.isFinite(delta) || delta === 0) {
    return;
  }

  const { data: rider, error } = await serviceClient
    .from('DispatchRiderRecord')
    .select('id,activeLoad')
    .eq('id', safeRiderId)
    .maybeSingle<Pick<DispatchRiderRow, 'id' | 'activeLoad'>>();

  if (error) {
    throw new Error(error.message);
  }

  if (!rider) {
    return;
  }

  const nextLoad = Math.max(0, Math.floor(parseInteger(rider.activeLoad, 0) + delta));
  const { error: updateError } = await serviceClient
    .from('DispatchRiderRecord')
    .update({
      activeLoad: nextLoad,
      updatedAt: nowIso(),
    })
    .eq('id', safeRiderId);

  if (updateError) {
    throw new Error(updateError.message);
  }
};

type DispatchCourierCandidate = {
  rider: DispatchRiderRow;
  userId: string;
  weight: number;
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
        restaurantCoordinates && riderCoordinates ? getDistanceKm(restaurantCoordinates, riderCoordinates) : null;

      return {
        rider: rider as DispatchRiderRow,
        userId,
        weight: buildDispatchCourierWeight(rider, distanceKm),
      } satisfies DispatchCourierCandidate;
    })
    .filter(Boolean) as DispatchCourierCandidate[];
};

const selectDispatchCourierForRestaurant = async (restaurantId: string) => {
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
      // Customer-facing price = restaurant's authoritative menu price + platform markup.
      price: roundCurrency(menuItem.price + CUSTOMER_ITEM_MARKUP),
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
  fulfillmentType,
  marketplaceMarkup = 0,
  subtotal,
}: {
  deliveryFee: number;
  fulfillmentType: 'delivery' | 'pickup';
  marketplaceMarkup?: number;
  subtotal: number;
}) => {
  const safeSubtotal = roundCurrency(subtotal);
  const markup = roundCurrency(Math.max(marketplaceMarkup, 0));
  // The restaurant is settled on its own menu prices only; the per-item marketplace
  // markup is platform margin and is excluded from the restaurant's commission basis.
  const restaurantBasis = roundCurrency(Math.max(safeSubtotal - markup, 0));
  const dispatchFee = roundCurrency(deliveryFee);
  const commissionRate = PLATFORM_COMMISSION_RATES[fulfillmentType];
  const commission = roundCurrency(restaurantBasis * commissionRate);
  const restaurantPayable = roundCurrency(Math.max(restaurantBasis - commission, 0));
  const platformFee = roundCurrency(commission + markup);
  const netSettlement = roundCurrency(restaurantPayable + dispatchFee);

  return {
    basis: 'menu_subtotal',
    commissionRate,
    fulfillmentType,
    dispatchFee,
    marketplaceMarkup: markup,
    netSettlement,
    platformFee,
    restaurantPayable,
  };
};

const calculatePricing = ({
  deliveryFee,
  fulfillmentType,
  marketplaceMarkup = 0,
  subtotal,
  tip,
}: {
  deliveryFee: number;
  fulfillmentType: 'delivery' | 'pickup';
  marketplaceMarkup?: number;
  subtotal: number;
  tip: number;
}) => {
  const safeSubtotal = roundCurrency(subtotal);
  const safeDeliveryFee = roundCurrency(deliveryFee);
  const safeTip = roundCurrency(tip);
  const serviceFee = calculateServiceFee(safeSubtotal);
  const settlement = calculateSettlementBreakdown({
    deliveryFee: safeDeliveryFee,
    fulfillmentType,
    marketplaceMarkup,
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

  if (tipAmount < 0 || tipAmount > 200) {
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
  // Total platform markup baked into the subtotal above (CUSTOMER_ITEM_MARKUP per unit),
  // so settlement can credit the restaurant on its own menu prices.
  const marketplaceMarkup = items.reduce((sum, item) => sum + CUSTOMER_ITEM_MARKUP * item.quantity, 0);
  const deliveryFee = fulfillmentType === 'delivery' ? parseNumber(restaurant.deliveryFee, 0) : 0;
  const minOrder = parseNumber(restaurant.minOrder, 0);

  if (subtotal - marketplaceMarkup < minOrder) {
    fail(412, `This restaurant requires a minimum order of ${minOrder.toFixed(2)}.`);
  }

  const deliveryLocation =
    fulfillmentType === 'delivery' ? normalizeDeliveryLocation(requestData.deliveryLocation) : null;
  if (fulfillmentType === 'delivery' && !deliveryLocation) {
    fail(400, 'A valid delivery location is required.');
  }

  const pricing = calculatePricing({
    deliveryFee,
    fulfillmentType,
    marketplaceMarkup,
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
  attributedPromoId,
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
  attributedPromoId?: string | null;
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
    attributedPromoId: attributedPromoId ?? null,
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

  await broadcastOrderChanged(orderId, { restaurantId });

  return {
    createdAt,
    timeline,
  };
};

const upsertPaymentTransaction = async (payload: JsonObject & { reference: string }) => {
  const { data: existingTransaction, error: lookupError } = await serviceClient
    .from('PaymentTransaction')
    .select('id')
    .eq('reference', payload.reference)
    .maybeSingle<{ id: string }>();

  if (lookupError) {
    throw new Error(`Failed to resolve payment transaction id: ${lookupError.message}`);
  }

  const { error } = await serviceClient.from('PaymentTransaction').upsert(
    {
      id: existingTransaction?.id?.trim() || payload.reference.trim(),
      ...payload,
      updatedAt: new Date().toISOString(),
    },
    {
    onConflict: 'reference',
    }
  );

  if (error) {
    throw new Error(error.message);
  }
};

const insertDeliveryEvent = async (payload: JsonObject) => {
  const eventPayload = {
    id: crypto.randomUUID(),
    ...payload,
  };
  const { error } = await serviceClient.from('DeliveryEvent').insert(eventPayload);

  if (error) {
    throw new Error(error.message);
  }
};

const updateOrderRecord = async (orderId: string, updates: JsonObject) => {
  const { error } = await serviceClient.from('CustomerOrder').update(updates).eq('id', orderId);

  if (error) {
    throw new Error(error.message);
  }

  await broadcastOrderChanged(orderId);
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
        .select('orderId,dispatchId,dispatchOwnerId,courierId,courierName,assignedAt')
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

  const orderList = await Promise.all(((orders ?? []) as CustomerOrderRow[]).map((order) => maybeExpireUnpaidOrder(order)));
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

  const normalizedOrder = await maybeExpireUnpaidOrder(order);
  const { assignmentsByOrderId, eventsByOrderId, itemsByOrderId } = await loadOrderRelations([orderId]);
  return {
    assignment: assignmentsByOrderId.get(orderId) ?? null,
    events: includeEvents ? eventsByOrderId.get(orderId) ?? [] : [],
    items: itemsByOrderId.get(orderId) ?? [],
    order: normalizedOrder,
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

const FAILED_ORDER_STATUSES = new Set<string>([
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REJECTED,
  ORDER_STATUS.FAILED_DELIVERY,
]);

// Admin and partner order lists/counts stay clean: unpaid prepaid checkouts and
// failed outcomes (cancelled/rejected/failed delivery) are excluded. Customers
// always see their full order history via the customer read paths.
const isOrderCleanForReporting = (order: CustomerOrderRow) => {
  const paymentMethod = sanitizeText(order.payment?.method, 'cash');
  const paymentStatus = sanitizeText(order.payment?.status, PAYMENT_STATUS.PENDING);
  const currentStatus = normalizeOrderStatus(order.status);

  if (FAILED_ORDER_STATUSES.has(currentStatus)) {
    return false;
  }

  if (PREPAID_PAYMENT_METHODS.has(paymentMethod) && paymentStatus !== PAYMENT_STATUS.PAID) {
    return false;
  }

  return true;
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

const maybeExpireUnpaidOrder = async (order: CustomerOrderRow) => {
  const currentStatus = normalizeOrderStatus(order.status);
  if (TERMINAL_ORDER_STATUSES.has(currentStatus)) {
    return order;
  }

  const paymentMethod = sanitizeText(order.payment?.method);
  const paymentStatus = sanitizeText(order.payment?.status, PAYMENT_STATUS.PENDING);
  if (!PAYSTACK_PAYMENT_METHODS.has(paymentMethod) || paymentStatus !== PAYMENT_STATUS.PENDING) {
    return order;
  }

  const createdAt = toSortableTimestamp(order.createdAt);
  if (!createdAt || Date.now() - createdAt < ORDER_PAYMENT_TIMEOUT_MS) {
    return order;
  }

  const timedOutAt = nowIso();
  const payment = {
    ...(order.payment ?? {}),
    lastEvent: 'payment_timeout',
    failedAt: timedOutAt,
    status: PAYMENT_STATUS.FAILED,
    verifiedAt: timedOutAt,
  };
  const cancellation = {
    actor: 'system',
    reason: 'payment_timeout',
    timedOutAt,
  };
  const timeline = {
    ...(order.timeline ?? {}),
    cancelledAt: timedOutAt,
    paymentTimedOutAt: timedOutAt,
  };

  await updateOrderRecord(order.id, {
    cancellation,
    payment,
    status: ORDER_STATUS.CANCELLED,
    timeline,
    updatedAt: timedOutAt,
  });

  await insertDeliveryEvent({
    actorUid: null,
    details: {
      timeoutMinutes: ORDER_PAYMENT_TIMEOUT_MS / 60000,
    },
    eventType: 'payment_timeout',
    orderId: order.id,
  });

  await notifyUsers([order.customerId], {
    title: 'Order timed out',
    body: `Order ${order.id.slice(-6).toUpperCase()} was cancelled because payment was not completed in time.`,
    data: buildNotificationData({
      app: 'customer',
      orderId: order.id,
      routeKey: 'customer_order_detail',
      type: 'order_update',
    }),
  });
  await notifyRestaurantUsers(order.restaurantId, {
    title: 'Unpaid order cancelled',
    body: `Order ${order.id.slice(-6).toUpperCase()} expired after the payment window closed.`,
    data: buildNotificationData({
      app: 'partner',
      orderId: order.id,
      routeKey: 'partner_order_detail',
      type: 'order_update',
    }),
  });

  return {
    ...order,
    cancellation,
    payment,
    status: ORDER_STATUS.CANCELLED,
    timeline,
    updatedAt: timedOutAt,
  };
};

const hasAssignedCourier = (assignment: DeliveryAssignmentRow | null) =>
  Boolean(sanitizeText(assignment?.courierId));

const getDispatchAssignmentOwnerId = (assignment: DeliveryAssignmentRow | null) =>
  sanitizeText(assignment?.dispatchOwnerId) ?? sanitizeText(assignment?.dispatchId);

const assignDispatchOwnerForOrder = async (
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
    case 'delivered':
      // Restaurants that self-provision delivery (and pickup handoffs) complete
      // their own orders — no platform rider is involved.
      if (![ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(currentStatus)) {
        fail(412, 'Only orders that are ready can be marked delivered.');
      }

      return {
        status: ORDER_STATUS.DELIVERED,
        timelinePatch: {
          ...(currentStatus === ORDER_STATUS.PREPARING ? { readyAt: currentTimelineAt } : {}),
          deliveredAt: currentTimelineAt,
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
const DEFAULT_PAYSTACK_CALLBACK_URL = 'https://feasty.com/payment/callback';
const getPaystackCallbackUrl = () =>
  sanitizeOptionalText(Deno.env.get('PAYSTACK_CALLBACK_URL')) ?? DEFAULT_PAYSTACK_CALLBACK_URL;
const getNormalizedPaystackCallbackUrl = (callbackUrl: unknown) => {
  const rawCallbackUrl = sanitizeOptionalText(callbackUrl);

  if (!rawCallbackUrl) {
    return getPaystackCallbackUrl();
  }

  try {
    const parsed = new URL(rawCallbackUrl);
    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, '');

    if ((scheme === 'http' || scheme === 'https') && pathname === 'payment/callback') {
      return parsed.toString();
    }

    if (scheme === 'feasty-customer' && pathname === 'payment/callback') {
      return parsed.toString();
    }
  } catch {
    // Fall back to the configured environment callback below.
  }

  return getPaystackCallbackUrl();
};

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
  return `FEASTY-${prefix}-${orderId.slice(-8).toUpperCase()}-${Date.now()}`;
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

  let response: Response;
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${getPaystackSecretKey()}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(PAYSTACK_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      fail(504, `Paystack request to ${path} timed out after ${PAYSTACK_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  }

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
    isPublished:
      allowPublish && input.isPublished !== undefined ? input.isPublished === true : existingPublished,
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
  const nextUpdates = {
    ...updates,
    updatedAt: nowIso(),
  };

  const { error } = await serviceClient.from('UserAccount').update(nextUpdates).eq('uid', uid);
  if (error) {
    throw new Error(error.message);
  }
};

const upsertUserAccount = async (record: JsonObject) => {
  const nextRecord = {
    ...record,
    updatedAt: nowIso(),
  };

  const { error } = await serviceClient.from('UserAccount').upsert(nextRecord, { onConflict: 'uid' });
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

const validateOffboardingEligibility = async (targetUid: string, role: string, account: UserAccountRow) => {
  if (role === 'restaurant') {
    const managedRestaurant = await loadManagedRestaurantForUser(targetUid, role);
    if (managedRestaurant.restaurant || sanitizeOptionalText(account.restaurantId)) {
      fail(
        412,
        'Partner accounts linked to a restaurant must be offboarded by admin so store ownership and order history stay traceable.'
      );
    }
  }

  if (role === 'dispatch') {
    const [{ data: rider, error: riderError }, { data: assignments, error: assignmentError }] = await Promise.all([
      serviceClient
        .from('DispatchRiderRecord')
        .select('id,activeLoad')
        .eq('id', targetUid)
        .maybeSingle<{ id: string; activeLoad?: number | null }>(),
      serviceClient.from('DeliveryAssignment').select('orderId,courierId').eq('courierId', targetUid),
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
};

const offboardUserAccount = async (targetUid: string, actorUid: string, auditAction: string, details: JsonObject = {}) => {
  await createAuditEntry(actorUid, auditAction, 'user', targetUid, details);
  await updateSupabaseAuthUser(targetUid, {
    ban_duration: '876000h',
  }).catch(() => undefined);

  const cleanupOperations = await Promise.allSettled([
    (async () => {
      const { error } = await serviceClient.from('DispatchApplicationRecord').delete().eq('id', targetUid);
      if (error) {
        throw new Error(error.message);
      }
    })(),
    (async () => {
      const { error } = await serviceClient.from('PartnerApplicationRecord').delete().eq('id', targetUid);
      if (error) {
        throw new Error(error.message);
      }
    })(),
    (async () => {
      const { error } = await serviceClient.from('DispatchRiderRecord').delete().eq('id', targetUid);
      if (error) {
        throw new Error(error.message);
      }
      await broadcastRidersChanged();
    })(),
    deleteUserRoleLinks(targetUid),
    deleteUserAccount(targetUid),
  ]);

  const cleanupFailures = cleanupOperations.filter((result) => result.status === 'rejected');
  if (cleanupFailures.length > 0) {
    await updateSupabaseAuthUser(targetUid, {
      ban_duration: 'none',
    }).catch(() => undefined);
    fail(
      409,
      'Account deletion could not be completed cleanly. No records were removed from sign-in, so try again or contact support.'
    );
  }

  await deleteSupabaseAuthUser(targetUid);
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

const ensureDispatchRiderRecord = async (
  riderId: string,
  riderData: {
    acceptanceRate?: number | null;
    activeLoad?: number;
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
      activeLoad: Math.max(0, Math.floor(riderData.activeLoad ?? 0)),
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

  if (action === 'promoTrack') {
    // Anon-allowed: browsing customers are frequently not signed in. Fire-and-forget
    // from the client, so failures here are still returned but never block the UI.
    const parsed = validatePromoTrack(data);
    if (!parsed.ok) {
      fail(400, parsed.message);
      return;
    }
    const { error } = await serviceClient.from('PromoEvent').insert({
      promoId: parsed.value.promoId,
      type: parsed.value.type,
    });
    if (error) {
      throw new Error(error.message);
    }
    return json(200, { data: { ok: true } });
  }

  const context = await getAuthenticatedRequestContext(request);

  if (action === 'getPolicyAcceptance') {
    const app = normalizePolicyApp(data.app);
    if (!app) {
      fail(400, 'A valid app is required.');
    }

    return json(200, {
      data: await hasCurrentPolicyAcceptance(context.uid, app),
    });
  }

  if (action === 'recordPolicyAcceptance') {
    const requestedApp = normalizePolicyApp(data.app);
    if (!requestedApp) {
      fail(400, 'A valid app is required.');
    }

    const acceptance = validatePolicyAcceptancePayload(
      {
        accepted: data.accepted,
        app: requestedApp,
        privacyVersion: data.privacyVersion,
        source: data.source,
        termsVersion: data.termsVersion,
      },
      requestedApp as 'customer' | 'partner' | 'dispatch',
      `${requestedApp}_policy_gate`
    );
    const acceptedAt = await recordPolicyAcceptance(context.uid, context.email, acceptance);

    return json(200, {
      data: {
        accepted: true,
        acceptedAt,
        privacyVersion: CURRENT_PRIVACY_VERSION,
        termsVersion: CURRENT_TERMS_VERSION,
      },
    });
  }

  if (action === 'provisionStaffAccount') {
    ensureRole(context.role, ['admin']);
    const email = sanitizeText(data.email).toLowerCase();
    const password = sanitizeText(data.password);
    const displayName = sanitizeOptionalText(data.displayName);
    const requestedRestaurantId = sanitizeText(data.restaurantId);
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

    let restaurantId = ['restaurant', 'dispatch'].includes(role) ? requestedRestaurantId : null;
    let restaurantName: string | null = null;

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
    if (['restaurant', 'dispatch'].includes(role) && !restaurantId) {
      restaurantId = sanitizeText(existingAccount?.restaurantId);
    }

    if (restaurantId) {
      const linkedRestaurant = await loadRestaurantById(restaurantId);
      if (!linkedRestaurant.restaurant) {
        fail(404, 'The selected restaurant could not be found.');
      }

      restaurantName = sanitizeText(linkedRestaurant.restaurant.name, sanitizeText(existingAccount?.restaurantName, 'Restaurant'));
    }

    await upsertUserAccount({
      uid: targetUid,
      email,
      displayName:
        displayName ?? sanitizeOptionalText(authUser.user_metadata?.full_name) ?? existingAccount?.displayName ?? email.split('@')[0],
      emailVerified: Boolean(authUser.email_confirmed_at ?? true),
      phoneNumber: existingAccount?.phoneNumber ?? null,
      createdAt: existingAccount?.createdAt ?? now,
      updatedAt: now,
      restaurantId,
      restaurantName,
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
      restaurantId,
      restaurantLinkedAt: restaurantId ? now : null,
      restaurantLinkSource: restaurantId ? 'staff_account_provisioned' : null,
      restaurantName,
    });
    if (role === 'dispatch') {
      await ensureDispatchRiderRecord(targetUid, {
        activeLoad: 0,
        completedTrips: 0,
        displayName:
          displayName ?? sanitizeOptionalText(authUser.user_metadata?.full_name) ?? existingAccount?.displayName ?? email.split('@')[0],
        phoneNumber: existingAccount?.phoneNumber ?? null,
        status: DEFAULT_DISPATCH_STATUS,
        vehicleType: DEFAULT_DISPATCH_VEHICLE,
        zone: sanitizeText(existingAccount?.restaurantName, 'Unassigned coverage area'),
      });
    }
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
    const requestedRestaurantId = sanitizeText(data.restaurantId);
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

    const existingRestaurantId = sanitizeText(account.restaurantId);
    const restaurantId =
      ['restaurant', 'dispatch'].includes(nextRole) ? requestedRestaurantId ?? existingRestaurantId : null;
    let restaurantName: string | null = null;
    let restaurantLinkedAt: string | null | undefined;
    let restaurantLinkSource: string | null | undefined;

    if (restaurantId) {
      const linkedRestaurant = await loadRestaurantById(restaurantId);
      if (!linkedRestaurant.restaurant) {
        fail(404, 'The selected restaurant could not be found.');
      }

      restaurantName = sanitizeText(linkedRestaurant.restaurant.name, sanitizeText(account.restaurantName, 'Restaurant'));
      restaurantLinkedAt = sanitizeText(account.restaurantLinkedAt) ?? nowIso();
      restaurantLinkSource = 'admin_role_assignment';
    } else if (!['restaurant', 'dispatch'].includes(nextRole)) {
      restaurantName = null;
      restaurantLinkedAt = null;
      restaurantLinkSource = null;
    }

    await syncUserRoleState(targetUid, nextRole, context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: PRIVILEGED_APP_ROLES.has(nextRole) ? nextRole : null,
      restaurantId,
      restaurantLinkedAt,
      restaurantLinkSource,
      restaurantName,
    });
    if (nextRole === 'dispatch') {
      await ensureDispatchRiderRecord(targetUid, {
        activeLoad: 0,
        completedTrips: 0,
        displayName: sanitizeText(account.displayName, account.email.split('@')[0]),
        phoneNumber: sanitizeOptionalText(account.phoneNumber),
        status: DEFAULT_DISPATCH_STATUS,
        vehicleType: DEFAULT_DISPATCH_VEHICLE,
        zone: sanitizeText(account.restaurantName, 'Unassigned coverage area'),
      });
    }
    await createAuditEntry(context.uid, 'role_assigned', 'user_role', targetUid, {
      role: nextRole,
      restaurantId,
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

  if (action === 'updateUserRestaurantLink') {
    ensureRole(context.role, ['admin']);
    const targetUid = sanitizeText(data.targetUid);
    const requestedRestaurantId = sanitizeText(data.restaurantId);
    if (!targetUid) {
      fail(400, 'A target uid is required.');
    }

    const account = await loadUserAccount(targetUid);
    if (!account) {
      fail(404, 'The selected user could not be found.');
    }

    const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
    const role = resolvePrimaryRole(account, roles);
    if (!['restaurant', 'dispatch'].includes(role)) {
      fail(412, 'Only partner and dispatch accounts can be linked to a restaurant.');
    }

    let restaurantId: string | null = null;
    let restaurantName: string | null = null;
    let restaurantLinkedAt: string | null = null;
    let restaurantLinkSource: string | null = null;

    if (requestedRestaurantId) {
      const linkedRestaurant = await loadRestaurantById(requestedRestaurantId);
      if (!linkedRestaurant.restaurant) {
        fail(404, 'The selected restaurant could not be found.');
      }

      restaurantId = requestedRestaurantId;
      restaurantName = sanitizeText(linkedRestaurant.restaurant.name, sanitizeText(account.restaurantName, 'Restaurant'));
      restaurantLinkedAt = nowIso();
      restaurantLinkSource = 'admin_access_console';
    }

    await syncUserRoleState(targetUid, role, context.uid, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: PRIVILEGED_APP_ROLES.has(role) ? role : null,
      restaurantId,
      restaurantLinkedAt,
      restaurantLinkSource,
      restaurantName,
    });
    await createAuditEntry(context.uid, 'restaurant_link_updated', 'user_role', targetUid, {
      restaurantId,
      role,
    });

    return json(200, {
      data: {
        restaurantId,
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
    if (restoreRole === 'dispatch') {
      await ensureDispatchRiderRecord(targetUid, {
        activeLoad: 0,
        completedTrips: 0,
        displayName: sanitizeText(account.displayName, account.email.split('@')[0]),
        phoneNumber: sanitizeOptionalText(account.phoneNumber),
        status: DEFAULT_DISPATCH_STATUS,
        vehicleType: DEFAULT_DISPATCH_VEHICLE,
        zone: sanitizeText(account.restaurantName, 'Unassigned coverage area'),
      });
    }
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

    if (context.role === 'restaurant' || context.role === 'dispatch') {
      await validateOffboardingEligibility(context.uid, context.role, account);
    }

    await offboardUserAccount(context.uid, context.uid, 'self_account_deleted', {
      role: context.role,
    });

    return json(200, {
      data: {
        deleted: true,
        targetUid: context.uid,
      },
    });
  }

  if (action === 'deleteAdminAccess') {
    ensureRole(context.role, ['admin']);
    const targetUid = sanitizeText(data.targetUid);
    if (!targetUid) {
      fail(400, 'A target uid is required.');
    }
    if (targetUid === context.uid) {
      fail(412, 'Use the signed-in admin offboarding flow for your own account.');
    }

    const account = await loadUserAccount(targetUid);
    if (!account) {
      fail(404, 'The selected user could not be found.');
    }

    const roles = Array.from((await loadUserRoles([targetUid])).get(targetUid) ?? []);
    const resolvedRole = resolvePrimaryRole(account, roles);
    if (resolvedRole !== 'admin') {
      fail(412, 'This action only deletes admin access. Use role revoke or disable access for other accounts.');
    }

    await offboardUserAccount(targetUid, context.uid, 'admin_account_deleted', {
      email: account.email,
      role: resolvedRole,
    });

    return json(200, {
      data: {
        deleted: true,
        role: resolvedRole,
        targetUid,
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
    const policyAcceptance = validatePolicyAcceptancePayload(
      data.policyAcceptance,
      'partner',
      'partner_signup'
    );
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
    const restaurantId = existingApplication?.restaurantId ?? crypto.randomUUID();

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
        status: PARTNER_APPLICATION_STATUS.APPROVED,
        restaurantId,
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

    const currentAccount = await loadUserAccount(context.uid);
    await syncUserRoleState(context.uid, 'restaurant', null, {
      accountDisabled: false,
      disabledAt: null,
      disabledByUid: null,
      lastPrivilegedRole: 'restaurant',
      restaurantId,
      restaurantLinkedAt: updatedAt,
      restaurantLinkSource: 'partner_application_self_publish',
      restaurantName: restaurantName,
    });
    const { error: restaurantError } = await serviceClient.from('RestaurantRecord').upsert(
      {
        id: restaurantId,
        ownerId: context.uid,
        name: restaurantName,
        nameKey: buildNameKey(restaurantName),
        cuisine,
        address,
        description: description ?? '',
        image: '',
        logoImage: logoImage ?? '',
        menu: [],
        deliveryFee: 0,
        deliveryRadiusKm: 12,
        deliveryTime,
        latitude: hasLatitude ? latitude : null,
        longitude: hasLongitude ? longitude : null,
        minOrder: 0,
        // Delivery is opt-in: restaurants self-provision it later from their
        // profile. New restaurants launch pickup-only ("delivery coming soon").
        supportsDelivery: false,
        supportsPickup: true,
        isOpen: true,
        isPublished: true,
        updatedAt,
      },
      { onConflict: 'id' }
    );

    if (restaurantError) {
      throw new Error(restaurantError.message);
    }

    await broadcastRestaurantsChanged({ restaurantId });

    const { error: approvalError } = await serviceClient.from('RestaurantApproval').upsert(
      {
        restaurantId,
        status: 'approved',
        approvedByUid: context.uid,
        approvedAt: updatedAt,
        updatedAt,
      },
      { onConflict: 'restaurantId' }
    );

    if (approvalError) {
      throw new Error(approvalError.message);
    }

    await upsertUserAccount({
      uid: context.uid,
      email: context.email,
      displayName: contactName,
      phoneNumber,
      emailVerified: true,
      roleDisplay: 'restaurant',
      partnerApplicationStatus: PARTNER_APPLICATION_STATUS.APPROVED,
      partnerApplicationReviewedAt: updatedAt,
      partnerApplicationRejectionReason: null,
      restaurantId,
      restaurantName,
      createdAt: currentAccount?.createdAt ?? updatedAt,
      updatedAt,
    });
    await recordPolicyAcceptance(context.uid, context.email, policyAcceptance);
    await createAuditEntry(context.uid, 'partner_application_submitted', 'partner_application', context.uid, {
      cuisine,
      restaurantName,
      logoImage: logoImage ?? null,
    });
    await notifyAdmins({
      title: 'New restaurant published',
      body: `${restaurantName} is now live for customer discovery and partner management.`,
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
        status: PARTNER_APPLICATION_STATUS.APPROVED,
        submittedAt,
        restaurantId,
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
        .eq('status', DISPATCH_APPLICATION_STATUS.PENDING)
        .order('submittedAt', { ascending: false }),
      serviceClient
        .from('PartnerApplicationRecord')
        .select(
          'id,uid,email,contactName,phoneNumber,restaurantName,cuisine,address,description,logoImage,latitude,longitude,deliveryTime,status,restaurantId,submittedAt,reviewedAt,approvedByUid,rejectionReason,updatedAt'
        )
        .eq('status', PARTNER_APPLICATION_STATUS.PENDING)
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
      await ensureDispatchRiderRecord(applicationId, {
        acceptanceRate: 100,
        activeLoad: 0,
        completedTrips: 0,
        currentAddress: application.currentAddress,
        displayName: sanitizeText(application.displayName, 'Dispatch rider'),
        lga: application.lga,
        latitude: parseNumber(application.latitude, DEFAULT_NIGERIA_COORDINATE.latitude),
        longitude: parseNumber(application.longitude, DEFAULT_NIGERIA_COORDINATE.longitude),
        phoneNumber: application.phoneNumber,
        region: application.region,
        status: DEFAULT_DISPATCH_STATUS,
        vehicleType: sanitizeText(application.vehicleType, DEFAULT_DISPATCH_VEHICLE),
        zone: sanitizeText(application.region),
      });

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
          // Delivery is opt-in — restaurant enables its own delivery later.
          supportsDelivery: false,
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

      await broadcastRestaurantsChanged({ restaurantId });

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
    return json(
      200,
      { data: { orders } },
      { 'Cache-Control': 'private, max-age=10, must-revalidate' }
    );
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

    const riderSnapshot = await loadDispatchRiderSnapshot(bundle.assignment?.courierId);

    return json(
      200,
      {
        data: {
          order: toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment, [], {
            ...riderSnapshot,
          }),
        },
      },
      { 'Cache-Control': 'private, max-age=6, must-revalidate' }
    );
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

    const { restaurant } = await loadRestaurantById(restaurantId);
    if (!restaurant || restaurant.isPublished !== true) {
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

    const orderCreation = await createOrderWithItems({
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

    await notifySafely(async () => {
      const restaurantName = sanitizeText(orderDraft.restaurant.name, 'the restaurant');
      await sendTransactionalEmail({
        to: context.email,
        subject: `Order ${shortOrderCode(orderId)} placed`,
        html: buildTransactionalEmailHtml({
          heading: 'Your order has been placed',
          lines: [
            `We received your order ${shortOrderCode(orderId)} for ${restaurantName}.`,
            `Total: ${formatNairaAmount(orderDraft.pricing.total)} (pay with cash on ${
              orderDraft.fulfillmentType === 'delivery' ? 'delivery' : 'pickup'
            }).`,
            'We will keep you posted as the restaurant confirms and prepares your order.',
          ],
        }),
      });
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
    const rawAttributedPromoId = sanitizeText(data.attributedPromoId);
    const attributedPromoId =
      rawAttributedPromoId && rawAttributedPromoId.length <= 128 ? rawAttributedPromoId : null;
    const paymentReference = buildPaystackReference(orderId, orderDraft.paymentMethod);
    const initialPayment = buildInitialPaymentSummary({
      paymentMethod: orderDraft.paymentMethod,
      reference: paymentReference,
      settlement: (orderDraft.pricing.settlement ?? null) as JsonObject | null,
    });

    const orderCreation = await createOrderWithItems({
      attributedPromoId,
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
        callbackUrl: getNormalizedPaystackCallbackUrl(data.callbackUrl),
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
        cancellation: {
          actor: 'system',
          reason: 'payment_initialization_failed',
        },
        payment: failedPayment,
        status: ORDER_STATUS.CANCELLED,
        timeline: {
          ...orderCreation.timeline,
          paymentInitializationFailedAt: nowIso(),
        },
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
    // Cancellation is only allowed before the kitchen starts preparing.
    if (![ORDER_STATUS.PLACED, ORDER_STATUS.ACCEPTED].includes(currentStatus)) {
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

    await adjustDispatchRiderLoad(bundle.assignment?.courierId, -1);

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

    const orderList = sortPartnerKitchenQueue(
      (await Promise.all(((orders ?? []) as CustomerOrderRow[]).map((order) => maybeExpireUnpaidOrder(order))))
        .filter(isOrderCleanForReporting)
    );
    const { assignmentsByOrderId, itemsByOrderId } = await loadOrderRelations(orderList.map((order) => order.id));
    const customerPhoneByUid = await loadUserPhoneNumbers(orderList.map((order) => order.customerId));

    return json(200, {
      data: {
        orders: orderList.map((order) =>
          toOrderSnapshotResponse(
            order,
            itemsByOrderId.get(order.id) ?? [],
            assignmentsByOrderId.get(order.id) ?? null,
            [],
            { customerPhone: customerPhoneByUid.get(order.customerId) ?? null }
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

    const customerPhone = await loadUserPhoneNumber(bundle.order.customerId);

    return json(200, {
      data: {
        order: toOrderSnapshotResponse(bundle.order, bundle.items, bundle.assignment, [], { customerPhone }),
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
      allowPublish: true,
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

    await broadcastRestaurantsChanged({ restaurantId });

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

    await broadcastRestaurantsChanged({ restaurantId });

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

    await broadcastRestaurantsChanged({ restaurantId });

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

    const payment = { ...(bundle.order.payment ?? {}) } as JsonObject;

    // Restaurant self-provisions delivery/pickup: when it completes the order,
    // a cash order is collected on handoff. Platform dispatch is shelved, so no
    // rider assignment happens here.
    if (nextState.status === ORDER_STATUS.DELIVERED && sanitizeText(payment.method, 'cash') === 'cash') {
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
  }

  if (action === 'syncDispatchRiderLocation') {
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

    const dispatchOwnerId = getDispatchAssignmentOwnerId(bundle.assignment ?? null);
    if (context.role !== 'admin' && dispatchOwnerId !== context.uid) {
      fail(403, 'This delivery is not assigned to your dispatcher queue.');
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
    const orders = (
      await Promise.all(
        ((ordersResult.data ?? []) as CustomerOrderRow[]).map((order) => maybeExpireUnpaidOrder(order))
      )
    ).filter(isOrderCleanForReporting);
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

  if (action === 'customerSendSupportMessage') {
    const body = sanitizeText(data.body);
    if (!body) {
      fail(400, 'A message body is required.');
    }

    // One thread per customer: find, create, or reopen if previously closed.
    const { data: existing, error: findError } = await serviceClient
      .from('SupportConversation')
      .select('*')
      .eq('customerId', context.uid)
      .maybeSingle<SupportConversationRow>();
    if (findError) {
      throw new Error(findError.message);
    }

    let conversation: SupportConversationRow;
    if (!existing) {
      const { data: created, error: createError } = await serviceClient
        .from('SupportConversation')
        .insert({ customerId: context.uid, status: 'open', subject: body.slice(0, 80) })
        .select('*')
        .single<SupportConversationRow>();
      if (createError || !created) {
        throw new Error(createError?.message ?? 'Failed to create the conversation.');
      }
      conversation = created;
    } else if (existing.status === 'closed') {
      const { data: reopened, error: reopenError } = await serviceClient
        .from('SupportConversation')
        .update({ status: 'open', updatedAt: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .single<SupportConversationRow>();
      if (reopenError || !reopened) {
        throw new Error(reopenError?.message ?? 'Failed to reopen the conversation.');
      }
      conversation = reopened;
    } else {
      conversation = existing;
    }

    const message = await appendSupportMessage({
      conversationId: conversation.id,
      senderType: 'customer',
      senderId: context.uid,
      body,
    });

    await broadcastSupportInboxChanged({ conversationId: conversation.id });
    await broadcastSupportThreadChanged(conversation.id, { messageId: message.id });

    return json(200, { data: { conversation, message } });
  }

  if (action === 'customerGetSupportThread') {
    const { data: conversation, error: convError } = await serviceClient
      .from('SupportConversation')
      .select('*')
      .eq('customerId', context.uid)
      .maybeSingle<SupportConversationRow>();
    if (convError) {
      throw new Error(convError.message);
    }
    if (!conversation) {
      return json(200, { data: { conversation: null, messages: [] } });
    }

    const { data: messages, error: msgError } = await serviceClient
      .from('SupportMessage')
      .select('*')
      .eq('conversationId', conversation.id)
      .order('createdAt', { ascending: true })
      .returns<SupportMessageRow[]>();
    if (msgError) {
      throw new Error(msgError.message);
    }
    return json(200, { data: { conversation, messages: messages ?? [] } });
  }

  if (action === 'supportGetInbox') {
    ensureRole(context.role, ['admin', 'support']);
    const status = sanitizeText(data.status);
    const scope = sanitizeText(data.scope) || 'all';

    let query = serviceClient
      .from('SupportConversation')
      .select('*')
      .order('lastMessageAt', { ascending: false });
    if (status && isSupportStatus(status)) {
      query = query.eq('status', status);
    }
    if (scope === 'mine') {
      query = query.eq('assignedTo', context.uid);
    } else if (scope === 'unassigned') {
      query = query.is('assignedTo', null);
    }

    const { data: conversations, error } = await query.returns<SupportConversationRow[]>();
    if (error) {
      throw new Error(error.message);
    }

    const customerIds = Array.from(new Set((conversations ?? []).map((row) => row.customerId)));
    const accountsById = new Map<string, { displayName: string | null; email: string }>();
    if (customerIds.length > 0) {
      const { data: accounts, error: accountsError } = await serviceClient
        .from('UserAccount')
        .select('uid,displayName,email')
        .in('uid', customerIds)
        .returns<Array<{ uid: string; displayName: string | null; email: string }>>();
      if (accountsError) {
        throw new Error(accountsError.message);
      }
      for (const account of accounts ?? []) {
        accountsById.set(account.uid, { displayName: account.displayName, email: account.email });
      }
    }

    const rows = (conversations ?? []).map((row) => ({
      ...row,
      customerName:
        accountsById.get(row.customerId)?.displayName ??
        accountsById.get(row.customerId)?.email ??
        row.customerId,
    }));
    return json(200, { data: { conversations: rows } });
  }

  if (action === 'supportGetConversation') {
    ensureRole(context.role, ['admin', 'support']);
    const conversationId = sanitizeText(data.conversationId);
    if (!conversationId) {
      fail(400, 'A conversationId is required.');
    }

    const { data: conversation, error: convError } = await serviceClient
      .from('SupportConversation')
      .select('*')
      .eq('id', conversationId)
      .maybeSingle<SupportConversationRow>();
    if (convError) {
      throw new Error(convError.message);
    }
    if (!conversation) {
      fail(404, 'Conversation not found.');
    }

    const { data: messages, error: msgError } = await serviceClient
      .from('SupportMessage')
      .select('*')
      .eq('conversationId', conversationId)
      .order('createdAt', { ascending: true })
      .returns<SupportMessageRow[]>();
    if (msgError) {
      throw new Error(msgError.message);
    }
    return json(200, { data: { conversation, messages: messages ?? [] } });
  }

  if (action === 'supportSendAgentReply') {
    ensureRole(context.role, ['admin', 'support']);
    const conversationId = sanitizeText(data.conversationId);
    const body = sanitizeText(data.body);
    if (!conversationId) {
      fail(400, 'A conversationId is required.');
    }
    if (!body) {
      fail(400, 'A reply body is required.');
    }

    const { data: conversation, error: convError } = await serviceClient
      .from('SupportConversation')
      .select('*')
      .eq('id', conversationId)
      .maybeSingle<SupportConversationRow>();
    if (convError) {
      throw new Error(convError.message);
    }
    if (!conversation) {
      fail(404, 'Conversation not found.');
    }

    // Persist first so the reply is never lost, even if delivery fails.
    const message = await appendSupportMessage({
      conversationId: conversation.id,
      senderType: 'agent',
      senderId: context.uid,
      body,
    });

    // In-app: broadcast to the customer's thread and the inbox.
    await broadcastSupportThreadChanged(conversation.id, { messageId: message.id });
    await broadcastSupportInboxChanged({ conversationId: conversation.id });

    // Email (best-effort).
    let emailSent = false;
    const recipient = await loadUserEmailRecipient(conversation.customerId);
    if (recipient) {
      const html = buildTransactionalEmailHtml({
        heading: 'FEASTy Support replied',
        recipientName: recipient.displayName,
        lines: [body, 'Reply to this message inside the FEASTy app to continue the conversation.'],
      });
      const emailResult = await sendTransactionalEmail({
        to: recipient.email,
        subject: 'FEASTy Support',
        html,
      });
      emailSent = emailResult.sent;
    }

    // Push (best-effort).
    let pushSent = false;
    try {
      const pushResult = await sendPushNotificationsToUsers([conversation.customerId], {
        title: 'FEASTy Support',
        body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
        data: { type: 'support_reply', path: '/support', routeKey: 'customer_profile', app: 'customer' },
      });
      pushSent = pushResult.sent > 0;
    } catch (error) {
      console.error('Support push delivery failed.', error);
    }

    await serviceClient
      .from('SupportMessage')
      .update({ emailSent, pushSent })
      .eq('id', message.id);

    return json(200, { data: { message: { ...message, emailSent, pushSent } } });
  }

  if (action === 'supportSetConversationStatus') {
    ensureRole(context.role, ['admin', 'support']);
    const conversationId = sanitizeText(data.conversationId);
    const status = sanitizeText(data.status);
    if (!conversationId) {
      fail(400, 'A conversationId is required.');
    }
    if (!status || !isSupportStatus(status)) {
      fail(400, 'A valid status is required.');
    }

    const { data: conversation, error } = await serviceClient
      .from('SupportConversation')
      .update({ status, updatedAt: new Date().toISOString() })
      .eq('id', conversationId)
      .select('*')
      .single<SupportConversationRow>();
    if (error || !conversation) {
      throw new Error(error?.message ?? 'Failed to update the conversation status.');
    }
    await broadcastSupportInboxChanged({ conversationId: conversation.id });
    return json(200, { data: { conversation } });
  }

  if (action === 'supportAssignConversation') {
    ensureRole(context.role, ['admin', 'support']);
    const conversationId = sanitizeText(data.conversationId);
    if (!conversationId) {
      fail(400, 'A conversationId is required.');
    }
    const assignToRaw = sanitizeText(data.assignTo);
    const assignTo = assignToRaw === 'me' ? context.uid : assignToRaw || null;

    const { data: conversation, error } = await serviceClient
      .from('SupportConversation')
      .update({ assignedTo: assignTo, updatedAt: new Date().toISOString() })
      .eq('id', conversationId)
      .select('*')
      .single<SupportConversationRow>();
    if (error || !conversation) {
      throw new Error(error?.message ?? 'Failed to assign the conversation.');
    }
    await broadcastSupportInboxChanged({ conversationId: conversation.id });
    return json(200, { data: { conversation } });
  }

  if (action === 'broadcastList') {
    ensureRole(context.role, ['admin']);
    const { data: broadcasts, error } = await serviceClient
      .from('Broadcast')
      .select('*')
      .order('createdAt', { ascending: false })
      .returns<BroadcastRow[]>();
    if (error) {
      throw new Error(error.message);
    }
    return json(200, { data: { broadcasts: broadcasts ?? [] } });
  }

  if (action === 'broadcastGet') {
    ensureRole(context.role, ['admin']);
    const broadcastId = sanitizeText(data.id);
    if (!broadcastId) {
      fail(400, 'A broadcast id is required.');
    }
    const { data: broadcast, error } = await serviceClient
      .from('Broadcast')
      .select('*')
      .eq('id', broadcastId)
      .maybeSingle<BroadcastRow>();
    if (error) {
      throw new Error(error.message);
    }
    if (!broadcast) {
      fail(404, 'Broadcast not found.');
    }
    return json(200, { data: { broadcast } });
  }

  if (action === 'broadcastPreviewAudience') {
    ensureRole(context.role, ['admin']);
    const category = sanitizeText(data.category) || 'transactional';
    const segment = (data.segment && typeof data.segment === 'object' ? data.segment : {}) as BroadcastSegment;
    const recipients = await resolveBroadcastAudience(segment, category);
    return json(200, { data: { recipientCount: recipients.length } });
  }

  if (action === 'broadcastCreate') {
    ensureRole(context.role, ['admin']);
    const title = sanitizeText(data.title);
    if (!title) {
      fail(400, 'A title is required.');
    }
    const { channels, segment } = validateBroadcastComposition({
      category: data.category,
      channels: data.channels,
      segment: data.segment,
      emailSubject: data.emailSubject,
      emailBody: data.emailBody,
      pushTitle: data.pushTitle,
      pushBody: data.pushBody,
    });
    const { data: broadcast, error } = await serviceClient
      .from('Broadcast')
      .insert({
        title,
        category: data.category,
        channels,
        segment,
        emailSubject: sanitizeText(data.emailSubject) || null,
        emailBody: typeof data.emailBody === 'string' && data.emailBody.trim() ? data.emailBody : null,
        pushTitle: sanitizeText(data.pushTitle) || null,
        pushBody: sanitizeText(data.pushBody) || null,
        status: 'draft',
        createdByUid: context.uid,
      })
      .select('*')
      .single<BroadcastRow>();
    if (error || !broadcast) {
      throw new Error(error?.message ?? 'Failed to create the broadcast.');
    }
    return json(200, { data: { broadcast } });
  }

  if (action === 'broadcastSchedule') {
    ensureRole(context.role, ['admin']);
    const broadcastId = sanitizeText(data.id);
    if (!broadcastId) {
      fail(400, 'A broadcast id is required.');
    }
    const scheduledAtRaw = sanitizeText(data.scheduledAt);
    if (scheduledAtRaw && Number.isNaN(new Date(scheduledAtRaw).getTime())) {
      fail(400, 'A valid scheduledAt timestamp is required.');
    }
    const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw).toISOString() : new Date().toISOString();
    const { data: broadcast, error } = await serviceClient
      .from('Broadcast')
      .update({ status: 'scheduled', scheduledAt, updatedAt: new Date().toISOString() })
      .eq('id', broadcastId)
      .in('status', ['draft', 'scheduled', 'canceled', 'failed'])
      .select('*')
      .single<BroadcastRow>();
    if (error || !broadcast) {
      throw new Error(error?.message ?? 'Failed to schedule the broadcast.');
    }
    return json(200, { data: { broadcast } });
  }

  if (action === 'broadcastCancel') {
    ensureRole(context.role, ['admin']);
    const broadcastId = sanitizeText(data.id);
    if (!broadcastId) {
      fail(400, 'A broadcast id is required.');
    }
    const { data: broadcast, error } = await serviceClient
      .from('Broadcast')
      .update({ status: 'canceled', updatedAt: new Date().toISOString() })
      .eq('id', broadcastId)
      .eq('status', 'scheduled')
      .select('*')
      .single<BroadcastRow>();
    if (error || !broadcast) {
      throw new Error(error?.message ?? 'Only a scheduled broadcast can be canceled.');
    }
    return json(200, { data: { broadcast } });
  }

  if (action === 'promoList') {
    ensureRole(context.role, ['admin']);
    const { data: promos, error } = await serviceClient
      .from('Promo')
      .select('*')
      .order('createdAt', { ascending: false })
      .returns<PromoRow[]>();
    if (error) {
      throw new Error(error.message);
    }
    const { data: stats, error: statsError } = await serviceClient.rpc('ebuy_promo_stats');
    if (statsError) {
      console.error('Promo stats lookup failed.', statsError);
    }
    const statById = new Map<string, {
      promoId: string; impressions: number; clicks: number;
      attributedOrders: number; attributedRevenue: number;
    }>(
      (stats ?? []).map((s: {
        promoId: string; impressions: number; clicks: number;
        attributedOrders: number; attributedRevenue: number;
      }) => [s.promoId, s]),
    );
    const withStats = (promos ?? []).map((p) => {
      const s = statById.get(p.id);
      return {
        ...p,
        impressions: s?.impressions ?? 0,
        clicks: s?.clicks ?? 0,
        attributedOrders: s?.attributedOrders ?? 0,
        attributedRevenue: s?.attributedRevenue ?? 0,
      };
    });
    return json(200, { data: { promos: withStats } });
  }

  if (action === 'promoCreate') {
    ensureRole(context.role, ['admin']);
    const title = sanitizeText(data.title);
    const body = sanitizeText(data.body);
    if (!title) {
      fail(400, 'A title is required.');
    }
    if (!body) {
      fail(400, 'A body is required.');
    }
    const { actionUrl, startsAt, endsAt, imageUrl, detailBody, terms, ctaLabel } =
      validatePromoComposition({
        actionUrl: data.actionUrl,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        imageUrl: data.imageUrl,
        detailBody: data.detailBody,
        terms: data.terms,
        ctaLabel: data.ctaLabel,
      });
    const { data: promo, error } = await serviceClient
      .from('Promo')
      .insert({
        title,
        body,
        actionUrl,
        imageUrl,
        detailBody,
        terms,
        ctaLabel,
        startsAt,
        endsAt,
        active: true,
        createdByUid: context.uid,
      })
      .select('*')
      .single<PromoRow>();
    if (error || !promo) {
      throw new Error(error?.message ?? 'Failed to create the promo.');
    }
    // Live push to every connected app; clients refetch the active set. A failed
    // broadcast must never fail the insert, so this is best-effort inside the helper.
    await broadcastPromosChanged({ id: promo.id });
    return json(200, { data: { promo } });
  }

  if (action === 'promoSetActive') {
    ensureRole(context.role, ['admin']);
    const promoId = sanitizeText(data.id);
    if (!promoId) {
      fail(400, 'A promo id is required.');
    }
    if (typeof data.active !== 'boolean') {
      fail(400, 'An active flag is required.');
    }
    const { data: promo, error } = await serviceClient
      .from('Promo')
      .update({ active: data.active, updatedAt: new Date().toISOString() })
      .eq('id', promoId)
      .select('*')
      .single<PromoRow>();
    if (error || !promo) {
      throw new Error(error?.message ?? 'Failed to update the promo.');
    }
    await broadcastPromosChanged({ id: promo.id });
    return json(200, { data: { promo } });
  }

  return null;
};

type SupportConversationRow = {
  id: string;
  customerId: string;
  subject: string | null;
  status: string;
  assignedTo: string | null;
  channel: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

type SupportMessageRow = {
  id: string;
  conversationId: string;
  senderType: string;
  senderId: string | null;
  body: string;
  emailSent: boolean;
  pushSent: boolean;
  createdAt: string;
};

type BroadcastRow = {
  id: string;
  title: string;
  category: string;
  channels: string[];
  segment: BroadcastSegment;
  emailSubject: string | null;
  emailBody: string | null;
  pushTitle: string | null;
  pushBody: string | null;
  status: string;
  scheduledAt: string | null;
  recipientCount: number;
  sentEmail: number;
  failedEmail: number;
  sentPush: number;
  failedPush: number;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

type PromoRow = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  imageUrl: string | null;
  detailBody: string | null;
  terms: string | null;
  ctaLabel: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
};

const validatePromoComposition = (input: {
  actionUrl: unknown;
  startsAt: unknown;
  endsAt: unknown;
  imageUrl: unknown;
  detailBody: unknown;
  terms: unknown;
  ctaLabel: unknown;
}) => {
  const actionUrlRaw = sanitizeText(input.actionUrl);
  // Only in-app deep links are allowed — an absolute/external URL in a banner
  // that every user sees is an open-redirect footgun.
  if (actionUrlRaw && !actionUrlRaw.startsWith('/')) {
    fail(400, 'actionUrl must be an in-app path starting with "/".');
  }
  const actionUrl = actionUrlRaw || null;

  const parseWindow = (value: unknown, label: string): string | null => {
    const raw = sanitizeText(value);
    if (!raw) {
      return null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      fail(400, `A valid ${label} timestamp is required.`);
    }
    return parsed.toISOString();
  };

  const startsAt = parseWindow(input.startsAt, 'startsAt');
  const endsAt = parseWindow(input.endsAt, 'endsAt');
  if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    fail(400, 'endsAt must be after startsAt.');
  }
  const imageUrlRaw = sanitizeText(input.imageUrl);
  // Hero image, if present, must be a Supabase Storage public URL on this
  // project's storage host (same host we upload to) — never an arbitrary
  // external URL, or another project's storage host, shown to every customer.
  const storagePrefix = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}/storage/v1/object/public/promo-assets/`;
  if (imageUrlRaw && !imageUrlRaw.startsWith(storagePrefix)) {
    fail(400, 'imageUrl must be an uploaded promo asset.');
  }
  const imageUrl = imageUrlRaw || null;
  const detailBody = sanitizeText(input.detailBody) || null;
  const terms = sanitizeText(input.terms) || null;
  const ctaLabel = sanitizeText(input.ctaLabel) || null;
  return { actionUrl, startsAt, endsAt, imageUrl, detailBody, terms, ctaLabel };
};

const BROADCAST_CATEGORIES = ['marketing', 'transactional'] as const;
const isBroadcastCategory = (value: unknown): value is (typeof BROADCAST_CATEGORIES)[number] =>
  typeof value === 'string' && (BROADCAST_CATEGORIES as readonly string[]).includes(value);

const validateBroadcastComposition = (input: {
  category: unknown;
  channels: unknown;
  segment: unknown;
  emailSubject: unknown;
  emailBody: unknown;
  pushTitle: unknown;
  pushBody: unknown;
}) => {
  if (!isBroadcastCategory(input.category)) {
    fail(400, 'A valid category is required.');
  }
  const channels = Array.isArray(input.channels)
    ? input.channels.filter((channel) => channel === 'email' || channel === 'push')
    : [];
  if (channels.length === 0) {
    fail(400, 'At least one channel (email or push) is required.');
  }
  if (channels.includes('email') && (!sanitizeText(input.emailSubject) || !sanitizeText(input.emailBody))) {
    fail(400, 'Email subject and body are required for the email channel.');
  }
  if (channels.includes('push') && (!sanitizeText(input.pushTitle) || !sanitizeText(input.pushBody))) {
    fail(400, 'Push title and body are required for the push channel.');
  }
  const segment = (input.segment && typeof input.segment === 'object' ? input.segment : {}) as BroadcastSegment;
  if (
    input.category === 'marketing' &&
    !(segment.roles ?? []).includes('customer') &&
    !segment.activity &&
    !segment.restaurantId
  ) {
    fail(400, 'Marketing broadcasts must target customers.');
  }
  return { channels, segment };
};

const SUPPORT_STATUSES = ['open', 'pending', 'closed'] as const;
const isSupportStatus = (value: unknown): value is (typeof SUPPORT_STATUSES)[number] =>
  typeof value === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(value);

const appendSupportMessage = async (input: {
  conversationId: string;
  senderType: 'customer' | 'agent' | 'system';
  senderId: string | null;
  body: string;
  emailSent?: boolean;
  pushSent?: boolean;
}): Promise<SupportMessageRow> => {
  const { data, error } = await serviceClient
    .from('SupportMessage')
    .insert({
      conversationId: input.conversationId,
      senderType: input.senderType,
      senderId: input.senderId,
      body: input.body,
      emailSent: input.emailSent ?? false,
      pushSent: input.pushSent ?? false,
    })
    .select('*')
    .single<SupportMessageRow>();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to persist the support message.');
  }

  const timestamp = nowIso();
  await serviceClient
    .from('SupportConversation')
    .update({ lastMessageAt: timestamp, updatedAt: timestamp })
    .eq('id', input.conversationId);

  return data;
};

Deno.serve(async (request) => {
  const observation = createEdgeObservation(request, 'app-rpc');
  let response: Response | undefined;
  let capturedError: unknown = null;

  if (request.method === 'OPTIONS') {
    // A 204 response must not carry a body — Deno throws a TypeError otherwise,
    // which crashed the CORS preflight once gateway JWT verification was disabled.
    response = new Response(null, {
      headers: corsHeaders,
      status: 204,
    });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  if (request.method !== 'POST') {
    response = json(405, {
      error: {
        message: 'Use POST for app RPC requests.',
      },
    });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  let payload: { action?: string; data?: Record<string, unknown> } = {};

  try {
    payload = (await request.json().catch(() => ({}))) as typeof payload;
    const action = sanitizeText(payload.action);
    observation.action = action || undefined;

    if (!action) {
      response = json(400, {
        error: {
          message: 'An RPC action is required.',
        },
      });
      return response;
    }

    const executeAction = async () => {
      const nativeResponse = await handleNativeAction(action, request, payload.data ?? {});
      return (
        nativeResponse ??
        json(501, {
          error: {
            message: `The RPC action "${action}" is not implemented in the native Supabase backend.`,
          },
        })
      );
    };

    response = HOT_WRITE_ACTIONS.has(action)
      ? await runWithBackpressure(
          `app-rpc:${action}`,
          {
            maxConcurrent: HOT_WRITE_BACKPRESSURE_LIMITS[action] ?? 8,
            retryAfterSeconds: 3,
          },
          executeAction
        )
      : await executeAction();

    return response;
  } catch (error) {
    capturedError = error;
    const status =
      isEdgeBackpressureError(error)
        ? error.status
        : error instanceof RpcError
          ? error.status
          : error instanceof Error && error.message === 'Missing authorization header'
            ? 401
            : error instanceof Error && error.message === 'This account is disabled.'
              ? 403
              : 500;

    response = json(
      status,
      {
        error: {
          message:
            error instanceof Error ? error.message : 'Unexpected Edge RPC failure.',
        },
      },
      error instanceof Error && 'retryAfterSeconds' in error
        ? { 'Retry-After': String((error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 3) }
        : {}
    );
    return response;
  } finally {
    finishEdgeObservation(observation, {
      error: capturedError ?? undefined,
      status: response?.status ?? 500,
    });
  }
});
