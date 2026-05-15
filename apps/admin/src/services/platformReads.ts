import type {
  DispatchApplicationDocument,
  DispatchProfileDocument,
  OrderDocument,
  PartnerApplicationDocument,
  RestaurantDocument,
  UserDocument,
} from '../domain/entities';
import { callAdminBackendRpc } from './backendRpc';

type AdminDashboardSnapshot = {
  dispatchProfiles: DispatchProfileDocument[];
  orders: OrderDocument[];
  restaurants: RestaurantDocument[];
  users: UserDocument[];
};

export const getAdminDashboardSnapshot = async () =>
  callAdminBackendRpc<AdminDashboardSnapshot>('adminGetDashboardSnapshot');

export const getAdminAccessOverview = async () =>
  callAdminBackendRpc<{ users: UserDocument[] }>('adminGetAccessOverview');

export const getAdminApprovalQueue = async () =>
  callAdminBackendRpc<{
    dispatchApplications: DispatchApplicationDocument[];
    partnerApplications: PartnerApplicationDocument[];
    restaurants: RestaurantDocument[];
  }>('adminGetApprovalQueue');
