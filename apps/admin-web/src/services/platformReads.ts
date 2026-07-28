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
