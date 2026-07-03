import type {
  DispatchApplicationDocument,
  DispatchProfileDocument,
  OrderDocument,
  PartnerApplicationDocument,
  RestaurantDocument,
  UserDocument,
} from '../domain/entities';
import { callAdminBackendRpc } from './backendRpc';
import { getStoredAdminReadCache, storeStoredAdminReadCache } from './session';

type AdminDashboardSnapshot = {
  dispatchProfiles: DispatchProfileDocument[];
  orders: OrderDocument[];
  restaurants: RestaurantDocument[];
  users: UserDocument[];
};

export type AdminReadSource = 'live' | 'cache' | 'fallback';

export type AdminReadResult<T> = {
  data: T;
  source: AdminReadSource;
};

const DASHBOARD_CACHE_KEY = 'dashboard-snapshot';
const ACCESS_OVERVIEW_CACHE_KEY = 'access-overview';
const APPROVAL_QUEUE_CACHE_KEY = 'approval-queue';

const readAdminSnapshotWithCache = async <T>(
  cacheKey: string,
  loader: () => Promise<T>,
  fallback: T
): Promise<AdminReadResult<T>> => {
  try {
    const nextValue = await loader();
    await storeStoredAdminReadCache(cacheKey, nextValue);
    return {
      data: nextValue,
      source: 'live',
    };
  } catch {
    const cachedValue = await getStoredAdminReadCache<T>(cacheKey);

    if (cachedValue !== null) {
      return {
        data: cachedValue,
        source: 'cache',
      };
    }

    return {
      data: fallback,
      source: 'fallback',
    };
  }
};

export const getAdminDashboardSnapshot = async () =>
  readAdminSnapshotWithCache(
    DASHBOARD_CACHE_KEY,
    () => callAdminBackendRpc<AdminDashboardSnapshot>('adminGetDashboardSnapshot'),
    {
      dispatchProfiles: [],
      orders: [],
      restaurants: [],
      users: [],
    }
  );

export const getAdminAccessOverview = async () =>
  readAdminSnapshotWithCache(
    ACCESS_OVERVIEW_CACHE_KEY,
    () => callAdminBackendRpc<{ users: UserDocument[] }>('adminGetAccessOverview'),
    {
      users: [],
    }
  );

export const getAdminApprovalQueue = async () =>
  readAdminSnapshotWithCache(
    APPROVAL_QUEUE_CACHE_KEY,
    () =>
      callAdminBackendRpc<{
        dispatchApplications: DispatchApplicationDocument[];
        partnerApplications: PartnerApplicationDocument[];
        restaurants: RestaurantDocument[];
      }>('adminGetApprovalQueue'),
    {
      dispatchApplications: [],
      partnerApplications: [],
      restaurants: [],
    }
  );
