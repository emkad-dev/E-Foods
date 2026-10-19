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

export type AdminDashboardSnapshot = {
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
};

export type AdminOperationalAlertsResponse = {
  operationalAlerts: OperationalAlertRecord[];
};

export const getAdminOperationalAlerts = (input?: Record<string, unknown>) =>
  callAdminRpc<AdminOperationalAlertsResponse>('adminGetOperationalAlerts', input);

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

export type AdminDispatchOpsView = {
  activeAssignments: DispatchAssignmentRecord[];
  sosEvents: DispatchSosEventRecord[];
};

export const getAdminDispatchOpsView = () =>
  callAdminRpc<AdminDispatchOpsView>('adminGetDispatchOpsView');

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
}) => callAdminRpc<AdminUpsertFeatureFlagResponse>('adminUpsertFeatureFlag', input);

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
