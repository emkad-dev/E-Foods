import type { OrderDocument } from '../domain/entities';
import { supabase } from './supabase/config';
import { callCustomerBackendRpc } from './backendRpc';
import { createReadCache, type ReadCacheRequest } from './readCache';

const CUSTOMER_READ_CACHE_TTL_MS = 12_000;
const customerReadCache = createReadCache({ ttlMs: CUSTOMER_READ_CACHE_TTL_MS });

export const clearCustomerReadCache = () => {
  customerReadCache.clear();
};

const resolveSessionCacheKey = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id?.trim() || data.session?.access_token?.slice(-12) || 'anon';
};

// `fresh: true` skips the cached copy and refreshes it. Anything triggered by a
// change (realtime event, poll, pull-to-refresh, the customer's own action) must
// pass it: a 12-second-old copy read after a change is how the order screen got
// stuck stale. Only first loads and passive re-reads may use the cache.
export const getCustomerOrders = async (request: ReadCacheRequest = {}) => {
  const sessionKey = await resolveSessionCacheKey();
  return customerReadCache.read(
    `customerGetOrders:${sessionKey}`,
    () => callCustomerBackendRpc<{ orders: OrderDocument[] }>('customerGetOrders'),
    request
  );
};

export const getCustomerOrderDetail = async (orderId: string, request: ReadCacheRequest = {}) => {
  const sessionKey = await resolveSessionCacheKey();
  return customerReadCache.read(
    `customerGetOrderDetail:${sessionKey}:${orderId}`,
    () => callCustomerBackendRpc<{ order: OrderDocument }>('customerGetOrderDetail', { orderId }),
    request
  );
};
