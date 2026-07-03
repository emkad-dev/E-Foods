import type { OrderDocument } from '../domain/entities';
import { supabase } from './supabase/config';
import { callCustomerBackendRpc } from './backendRpc';

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const CUSTOMER_READ_CACHE_TTL_MS = 12_000;
const customerReadCache = new Map<string, CacheEntry<unknown>>();

const readCache = <T>(key: string): T | null => {
  const entry = customerReadCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    customerReadCache.delete(key);
    return null;
  }

  return entry.value as T;
};

const writeCache = <T>(key: string, value: T, ttlMs = CUSTOMER_READ_CACHE_TTL_MS) => {
  customerReadCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
};

export const clearCustomerReadCache = () => {
  customerReadCache.clear();
};

const resolveSessionCacheKey = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id?.trim() || data.session?.access_token?.slice(-12) || 'anon';
};

export const getCustomerOrders = async () => {
  const sessionKey = await resolveSessionCacheKey();
  const cacheKey = `customerGetOrders:${sessionKey}`;
  const cached = readCache<{ orders: OrderDocument[] }>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await callCustomerBackendRpc<{ orders: OrderDocument[] }>('customerGetOrders');
  writeCache(cacheKey, result);
  return result;
};

export const getCustomerOrderDetail = async (orderId: string) => {
  const sessionKey = await resolveSessionCacheKey();
  const cacheKey = `customerGetOrderDetail:${sessionKey}:${orderId}`;
  const cached = readCache<{ order: OrderDocument }>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await callCustomerBackendRpc<{ order: OrderDocument }>('customerGetOrderDetail', { orderId });
  writeCache(cacheKey, result);
  return result;
};
