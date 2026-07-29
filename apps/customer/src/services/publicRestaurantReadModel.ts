import type { RestaurantDocument } from '../domain/entities';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { supabase } from './supabase/config';
import { appEnv, supabaseEnv } from '../config/env';

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const PUBLIC_CATALOG_CACHE_TTL_MS = 30_000;
const publicCatalogCache = new Map<string, CacheEntry<unknown>>();

const readCache = <T>(key: string): T | null => {
  const entry = publicCatalogCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    publicCatalogCache.delete(key);
    return null;
  }

  return entry.value as T;
};

const writeCache = <T>(key: string, value: T, ttlMs = PUBLIC_CATALOG_CACHE_TTL_MS) => {
  publicCatalogCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
};

// Routes catalog reads through the Cloudflare edge cache (api.feasty.com.ng)
// when EXPO_PUBLIC_CATALOG_URL is set; response contract is identical to the
// Supabase function, so the result feeds the same envelope handling below.
const invokeViaEdgeCache = async <T>(
  action: string,
  data?: Record<string, unknown>
): Promise<T> => {
  const anonKey = supabaseEnv.anonKey ?? '';
  const response = await fetch(`${appEnv.catalogUrl}/public-catalog`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ action, data: data ?? {} }),
  });

  if (!response.ok) {
    let message = `Public catalog request failed with HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { message?: unknown; error?: unknown };
      const parsed = body?.message ?? body?.error;
      if (typeof parsed === 'string' && parsed.trim()) {
        message = parsed.trim();
      }
    } catch {
      // Keep the default message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
};

const callPublicCatalog = async <T>(action: string, data?: Record<string, unknown>) => {
  const cacheKey = `${action}:${JSON.stringify(data ?? {})}`;
  const cached = readCache<T>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    if (appEnv.catalogUrl) {
      const responseData = await invokeViaEdgeCache<T>(action, data);

      if (responseData && typeof responseData === 'object' && 'data' in responseData) {
        const dataValue = (responseData as { data: T }).data;
        writeCache(cacheKey, dataValue);
        return dataValue;
      }

      writeCache(cacheKey, responseData);
      return responseData;
    }

    const { data: responseData, error } = await supabase.functions.invoke<T>('public-catalog', {
      body: {
        action,
        data: data ?? {},
      },
    });

    if (error) {
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response | undefined;

        if (response) {
          const responseForJson = response.clone();
          let parsedMessage: string | null = null;

          try {
            const body = await responseForJson.json();
            const message =
              typeof body === 'object' && body !== null
                ? (body as { message?: unknown }).message ?? (body as { error?: unknown }).error
                : null;

            if (typeof message === 'string' && message.trim()) {
              parsedMessage = message.trim();
            }
          } catch {
            // Ignore JSON parse errors and fall back to text below.
          }

          if (parsedMessage) {
            throw new Error(parsedMessage);
          }

          const text = await response.text().catch(() => '');

          if (text.trim()) {
            throw new Error(text.trim());
          }

          throw new Error(`Public catalog request failed with HTTP ${response.status}.`);
        }
      }

      if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
        throw new Error(`The restaurant service is unreachable right now. Check your internet connection, DNS, or Supabase Edge deployment.`);
      }

      throw new Error(error instanceof Error ? error.message : 'Unexpected public catalog failure.');
    }

    if (responseData && typeof responseData === 'object' && 'data' in responseData) {
      const dataValue = (responseData as { data: T }).data;
      writeCache(cacheKey, dataValue);
      return dataValue;
    }

    writeCache(cacheKey, responseData as T);
    return responseData as T;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing Supabase configuration value')) {
      throw new Error('Missing public catalog configuration. Check your Supabase runtime env and try again.');
    }

    throw error instanceof Error
      ? error
      : new Error('The restaurant service is unreachable right now. Check your internet connection, DNS, or Supabase Edge deployment.');
  }
};

export const getPublishedRestaurants = async () =>
  callPublicCatalog<{ restaurants: RestaurantDocument[] }>('customerGetPublishedRestaurants');

export const getPublishedRestaurantDetail = async (restaurantId: string) =>
  callPublicCatalog<{ restaurant: RestaurantDocument | null }>('customerGetPublishedRestaurantDetail', {
    restaurantId,
  });
