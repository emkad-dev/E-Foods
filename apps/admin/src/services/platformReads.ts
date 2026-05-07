import { httpsCallable } from 'firebase/functions';
import type {
  DispatchApplicationDocument,
  DispatchProfileDocument,
  OrderDocument,
  PartnerApplicationDocument,
  RestaurantDocument,
  UserDocument,
} from '../domain/entities';
import { functions } from './firebase/config';

type AdminDashboardSnapshot = {
  dispatchProfiles: DispatchProfileDocument[];
  orders: OrderDocument[];
  restaurants: RestaurantDocument[];
  users: UserDocument[];
};

const adminGetDashboardSnapshotCallable = httpsCallable<Record<string, never>, AdminDashboardSnapshot>(
  functions,
  'adminGetDashboardSnapshot'
);

const adminGetAccessOverviewCallable = httpsCallable<Record<string, never>, { users: UserDocument[] }>(
  functions,
  'adminGetAccessOverview'
);

const adminGetApprovalQueueCallable = httpsCallable<
  Record<string, never>,
  {
    dispatchApplications: DispatchApplicationDocument[];
    partnerApplications: PartnerApplicationDocument[];
    restaurants: RestaurantDocument[];
  }
>(
  functions,
  'adminGetApprovalQueue'
);

export const getAdminDashboardSnapshot = async () => {
  const result = await adminGetDashboardSnapshotCallable({});
  return result.data;
};

export const getAdminAccessOverview = async () => {
  const result = await adminGetAccessOverviewCallable({});
  return result.data;
};

export const getAdminApprovalQueue = async () => {
  const result = await adminGetApprovalQueueCallable({});
  return result.data;
};
