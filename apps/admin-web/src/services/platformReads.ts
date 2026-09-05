import type {
  DispatchApplicationDocument,
  DispatchProfileDocument,
  OrderDocument,
  PartnerApplicationDocument,
  RestaurantDocument,
  UserDocument,
} from '../../../../packages/domain/src';
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

export type RiskSeverity = 'low' | 'medium' | 'high';

export type RiskEventRecord = {
  actorUid?: string | null;
  createdAt: string;
  dedupeKey: string;
  eventType: string;
  id: string;
  metadata: Record<string, unknown> | null;
  orderId?: string | null;
  paymentId?: string | null;
  paymentReference?: string | null;
  reason: string;
  score: number;
  severity: RiskSeverity;
  subjectId: string;
  subjectType: string;
  updatedAt: string;
};

export type AdminRiskEventsResponse = {
  riskEvents: RiskEventRecord[];
};

export const getAdminDashboardSnapshot = () => callAdminRpc<AdminDashboardSnapshot>('adminGetDashboardSnapshot');

export const getAdminAccessOverview = () => callAdminRpc<{ users: UserDocument[] }>('adminGetAccessOverview');

export const getAdminApprovalQueue = () => callAdminRpc<AdminApprovalQueue>('adminGetApprovalQueue');

export const getAdminRiskEvents = () => callAdminRpc<AdminRiskEventsResponse>('adminGetRiskEvents');

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
