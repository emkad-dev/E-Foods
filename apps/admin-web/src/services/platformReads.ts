import type {
  DispatchApplicationDocument,
  DispatchProfileDocument,
  OrderDocument,
  PartnerApplicationDocument,
  RestaurantDocument,
  UserDocument,
} from '../../../../packages/domain/src';
import type { AuditLogEntry } from '../lib/auditLog';
import { callAdminRpc } from '../lib/rpc';

/**
 * A cancelled, rejected or failed-delivery order. The backend sends the
 * cancellation `reason` (payment_timeout, admin_force_cancel...), which the
 * shared OrderDocument type does not declare; it is added here rather than in
 * packages/domain, so the other apps' types are untouched.
 */
// An intersection, not Omit<OrderDocument, ...>: OrderDocument carries an index
// signature, and Omit over one collapses every named field into `unknown`.
export type ClosedOrderDocument = OrderDocument & {
  cancellation?: { actor?: string | null; reason?: string | null; refundRate?: number | null } | null;
};

export type AdminDashboardSnapshot = {
  /**
   * Every order flagged needsAttention, whatever its status (cancelled and
   * rejected included). `orders` is the reporting feed and drops closed orders;
   * this list must not, or a refund to return by hand on a rejected order is
   * invisible. Absent on older backends.
   */
  attentionOrders?: OrderDocument[];
  /**
   * Every cancelled, rejected and failed-delivery order, with no cut-off. Kept
   * out of `orders` so they never count as revenue, but sent so the admin can
   * see them. Absent on backends older than this field.
   */
  closedOrders?: ClosedOrderDocument[];
  dispatchProfiles: DispatchProfileDocument[];
  featureFlags: Record<string, boolean>;
  orders: OrderDocument[];
  restaurants: RestaurantDocument[];
  users: UserDocument[];
};

export type AdminApprovalQueue = {
  dispatchApplications: DispatchApplicationDocument[];
  partnerApplications: PartnerApplicationDocument[];
  restaurants: RestaurantDocument[];
};

export const getAdminDashboardSnapshot = () => callAdminRpc<AdminDashboardSnapshot>('adminGetDashboardSnapshot');

export const getAdminAccessOverview = () => callAdminRpc<{ users: UserDocument[] }>('adminGetAccessOverview');

export const getAdminApprovalQueue = () => callAdminRpc<AdminApprovalQueue>('adminGetApprovalQueue');

export type OperationalAlertSeverity = 'low' | 'medium' | 'high';

export type OperationalAlertRecord = {
  alertType: string;
  createdAt: string;
  dedupeKey: string;
  details: string;
  id: string;
  metadata: Record<string, unknown>;
  severity: OperationalAlertSeverity;
  subjectId: string;
  subjectType: string;
  title: string;
  updatedAt: string;
  /** Null while the alert is open. Older servers omit both fields. */
  resolvedAt?: string | null;
  resolvedBy?: string | null;
};

export type AdminOperationalAlertsResponse = {
  operationalAlerts: OperationalAlertRecord[];
};

/** Resolved alerts are left out unless `includeResolved` is true. */
export const getAdminOperationalAlerts = (input?: Record<string, unknown>) =>
  callAdminRpc<AdminOperationalAlertsResponse>('adminGetOperationalAlerts', input);

export type ResolveOperationalAlertResult = {
  alert: OperationalAlertRecord;
  alreadyResolved: boolean;
};

export const resolveAdminOperationalAlert = (alertId: string) =>
  callAdminRpc<ResolveOperationalAlertResult>('adminResolveOperationalAlert', { alertId }, { write: true });

export type DispatchAssignmentRecord = {
  orderId: string;
  courierId: string | null;
  courierName: string | null;
  assignedAt: string | null;
  dispatchOwnerId: string | null;
};

export type DispatchSosEventRecord = {
  id: string;
  orderId: string;
  eventType: string;
  actorUid: string | null;
  details: Record<string, unknown> | null;
  createdAt: string | null;
};

export type InProgressDeliveryRecord = {
  orderId: string;
  status: string;
  restaurantName: string | null;
  courierId: string | null;
  courierName: string | null;
  assignedAt: string | null;
  updatedAt: string | null;
};

export type AdminDispatchOpsView = {
  activeAssignments: DispatchAssignmentRecord[];
  // Optional: an older server (deploy window) does not send it.
  inProgress?: InProgressDeliveryRecord[];
  // Optional: exact count of open rider orders, sent only with `inProgress`.
  inProgressTotal?: number;
  sosEvents: DispatchSosEventRecord[];
};

export const getAdminDispatchOpsView = () =>
  callAdminRpc<AdminDispatchOpsView>('adminGetDispatchOpsView');

export type AdminOrderDetailPayment = {
  amount: number;
  channel: string | null;
  createdAt: string | null;
  currency: string | null;
  failedAt: string | null;
  gatewayStatus: string | null;
  id: string;
  lastError: string | null;
  method: string | null;
  paidAt: string | null;
  provider: string | null;
  reference: string;
  settlementMode: string | null;
  status: string;
};

export type AdminOrderDetailEvent = {
  actorUid: string | null;
  createdAt: string | null;
  details: Record<string, unknown> | null;
  eventType: string;
  id: string;
  note: string | null;
};

export type AdminOrderDetailItem = {
  id: string;
  name: string;
  optionDelta: number;
  price: number;
  quantity: number;
  selectedOptions: Array<Record<string, unknown>>;
};

/** Mirrors adminGetOrderDetail (supabase/functions/_shared/domains/admin.ts). */
export type AdminOrderDetail = {
  assignment: {
    courierId: string | null;
    courierName: string | null;
    dispatchId: string | null;
    dispatchOwnerId: string | null;
  } | null;
  cancellation: Record<string, unknown> | null;
  createdAt: string | null;
  /** Customer confirmation (delivered orders the restaurant or an admin completed). */
  customerConfirmDueAt: string | null;
  customerConfirmedAt: string | null;
  customerConfirmationSource: 'customer' | 'auto' | null;
  customerIssueReportedAt: string | null;
  customer: {
    displayName: string | null;
    email: string | null;
    phoneNumber: string | null;
    uid: string;
  };
  deliveryAddress: string | null;
  deliveryCodeAttempts: number;
  deliveryCodeVerifiedAt: string | null;
  events: AdminOrderDetailEvent[];
  fulfillmentType: string;
  id: string;
  items: AdminOrderDetailItem[];
  needsAttention: boolean;
  orderGroupId: string | null;
  payment: Record<string, unknown>;
  payments: AdminOrderDetailPayment[];
  pricing: {
    currency?: string;
    /** 'platform' when a FEASTY rider delivers; absent for restaurant-run delivery and pickup. */
    deliveryProvider?: string;
    deliveryFee?: number;
    discount?: number;
    serviceFee?: number;
    subtotal?: number;
    tip?: number;
    total?: number;
  } | null;
  restaurantId: string;
  restaurantName: string;
  scheduledFor: string | null;
  status: string;
  timeline: Record<string, unknown> | null;
  total: number;
  updatedAt: string | null;
};

export const getAdminOrderDetail = (orderId: string) =>
  callAdminRpc<{ order: AdminOrderDetail }>('adminGetOrderDetail', { orderId });

/* ------------------------------------------------- admin order interventions */
// Mirror supabase/functions/_shared/adminOrderInterventions.ts. Writes: never
// re-sent automatically, so a lost response cannot turn into a second action.

export const forceCancelAdminOrder = (input: { orderId: string; reason: string }) =>
  callAdminRpc<{ needsAttention: boolean; orderId: string; refundRecorded: boolean; status: string }>(
    'adminForceCancelOrder',
    input,
    { write: true }
  );

export const forceCompleteAdminOrder = (input: { orderId: string; reason: string }) =>
  callAdminRpc<{ orderId: string; status: string }>('adminForceCompleteOrder', input, { write: true });

/**
 * Sends the order's recorded refund through Paystack. Mirrors
 * supabase/functions/_shared/adminOrderRefund.ts. 'failed' means Paystack
 * refused it (nothing sent, a retry is allowed); 'unconfirmed' means no
 * readable answer (check the Paystack dashboard first).
 */
export const sendAdminOrderRefund = (input: { mode?: 'paystack' | 'mark_manual'; note: string; orderId: string }) =>
  callAdminRpc<{
    orderId: string;
    /** blocked: Paystack already holds a refund on this charge that FEASTY did not send. */
    outcome: 'sent' | 'failed' | 'unconfirmed' | 'blocked' | 'marked_manual';
    refundExecution: Record<string, unknown> | null;
  }>('adminSendOrderRefund', input, { write: true });

export const resolveAdminOrderReport = (input: { note: string; orderId: string }) =>
  callAdminRpc<{ attentionResolvedAt: string; customerConfirmedAt: string | null; needsAttention: boolean; orderId: string }>(
    'adminResolveOrderReport',
    input,
    { write: true }
  );

/**
 * Per settlement mode: how many DELIVERED orders with the payment still paid,
 * and what the restaurant is OWED for them (its settlement share, not the gross
 * payment). Refunded, failed_delivery, cancelled and rejected orders count in
 * neither this nor the pending figure.
 */
export type SettlementTotals = {
  manualAmount: number;
  manualCount: number;
  splitAmount: number;
  splitCount: number;
  unknownAmount: number;
  unknownCount: number;
};

export type RestaurantPayoutRow = {
  hasSubaccount: boolean;
  id: string;
  isPaused: boolean;
  isPublished: boolean;
  name: string;
  /** Published but no subaccount: the platform is receiving this restaurant's money. */
  notSplitting: boolean;
  pausedUntil: string | null;
  payoutLastError: string | null;
  payoutProfileHasSubaccount: boolean;
  /** RestaurantPayout.status, 'none' when no payout profile exists. */
  payoutStatus: string;
  payoutUpdatedAt: string | null;
  /** Paid orders still in progress: not owed yet, they may still be rejected or cancelled. Absent on older backends. */
  pending?: PendingPayoutTotals;
  settlement: SettlementTotals;
};

export type PendingPayoutTotals = { amount: number; count: number };

/** Mirrors adminGetRestaurantPayouts (supabase/functions/_shared/domains/admin.ts). */
export type RestaurantDeliveryProvider = 'restaurant' | 'platform';

export type AdminRestaurantPayouts = {
  /** restaurantId -> who delivers its orders (rider pay). Absent on older backends. */
  deliveryProviders?: Record<string, RestaurantDeliveryProvider>;
  /** Checkout honours 'platform' only while this flag is on. */
  platformDispatchEnabled?: boolean;
  /** Platform-wide pending (paid, in progress). Absent on older backends. */
  platformPending?: PendingPayoutTotals;
  platformSettlement: SettlementTotals;
  restaurants: RestaurantPayoutRow[];
  windowDays: number;
};

export const getAdminRestaurantPayouts = () => callAdminRpc<AdminRestaurantPayouts>('adminGetRestaurantPayouts');

/** Mirrors adminSetRestaurantDeliveryProvider (supabase/functions/_shared/restaurantDeliveryProviderAdmin.ts). */
export const setAdminRestaurantDeliveryProvider = (input: {
  deliveryProvider: RestaurantDeliveryProvider;
  restaurantId: string;
}) =>
  callAdminRpc<{ deliveryProvider: RestaurantDeliveryProvider; id: string; name: string | null; previous: RestaurantDeliveryProvider }>(
    'adminSetRestaurantDeliveryProvider',
    input,
    { write: true }
  );

export type RiderRosterRow = {
  acceptanceRate: number | null;
  activeLoad: number;
  completedTrips: number;
  displayName: string;
  id: string;
  lastSeenAt: string | null;
  /** True when the live-location stamp is fresh (the rider's app is pinging). */
  online: boolean;
  status: string;
  vehicleType: string;
  verificationStatus: string;
  zone: string | null;
};

/** Mirrors adminGetRiderRoster (supabase/functions/_shared/domains/admin.ts). */
export type AdminRiderRoster = {
  riders: RiderRosterRow[];
};

export const getAdminRiderRoster = () => callAdminRpc<AdminRiderRoster>('adminGetRiderRoster');

export type RiderPayoutRow = {
  amount: number;
  createdAt: string | null;
  earningCount: number;
  failureReason: string | null;
  id: string;
  paidAt: string | null;
  reference: string;
  riderId: string;
  riderName: string | null;
  /** processing | paid | failed | reversed */
  status: string;
  transferCode: string | null;
};

/** Mirrors adminGetRiderPayouts (supabase/functions/_shared/riderPayoutAccount.ts). */
export type AdminRiderPayouts = {
  autoPayoutsEnabled: boolean;
  generatedAt: string;
  heldRiders: Array<{ displayName: string | null; holdReason: string | null; holdUntil: string | null; riderId: string }>;
  limits: {
    maxPerRiderPerDay: number;
    maxPerTransfer: number;
    maxPlatformPerDay: number;
    minPayout: number;
  };
  payouts: RiderPayoutRow[];
  totals: { pendingEarnings: number; processingEarnings: number; ridersWithRecipient: number };
};

export const getAdminRiderPayouts = () => callAdminRpc<AdminRiderPayouts>('adminGetRiderPayouts');

export type FeatureFlagRecord = {
  description: string | null;
  enabled: boolean;
  key: string;
  updatedAt: string;
};

export type AdminFeatureFlagsResponse = {
  featureFlags: FeatureFlagRecord[];
};

export type AdminUpsertFeatureFlagResponse = {
  featureFlag: FeatureFlagRecord;
};

export const listAdminFeatureFlags = () => callAdminRpc<AdminFeatureFlagsResponse>('adminListFeatureFlags');

export const upsertAdminFeatureFlag = (input: {
  description?: string | null;
  enabled: boolean;
  key: string;
}) => callAdminRpc<AdminUpsertFeatureFlagResponse>('adminUpsertFeatureFlag', input, { write: true });

/* ---------------------------------------------------------------- audit log */

export type AdminAuditLogRequest = {
  action?: string;
  actorUid?: string;
  /** Server clamps to 1..100; anything larger comes back as 100. */
  limit?: number;
  offset?: number;
  targetId?: string;
  targetType?: string;
};

export type AdminAuditLogResponse = {
  entries: AuditLogEntry[];
  /**
   * The server sets this when the page came back FULL, i.e. `entries.length
   * === limit`. It is a hint, not a count -- counting an append-only table on
   * every read costs more than the read -- so it can be true with nothing on
   * the next page. The pager treats it as "offer Older", never as a total.
   */
  hasMore: boolean;
  limit: number;
  offset: number;
};

/**
 * Read-only by construction: `adminGetAuditLog` has no update or delete
 * counterpart and AdminAuditLog is service-role-only, so there is deliberately
 * no mutating export beside this one.
 */
export const getAdminAuditLog = (input?: AdminAuditLogRequest) =>
  callAdminRpc<AdminAuditLogResponse>('adminGetAuditLog', input as Record<string, unknown> | undefined);
