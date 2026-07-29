import type { RestaurantDocument } from '../domain/entities';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { supabase } from './supabase/config';
import { appEnv, supabaseEnv } from '../config/env';

type CacheEntry<T> = {
  // Younger than freshUntil: serve straight from memory, no network at all.
  freshUntil: number;
  // Younger than staleUntil: serve ONLY as last-known-good when the network fails.
  staleUntil: number;
  value: T;
};

// Serve without touching the network for this long.
const PUBLIC_CATALOG_FRESH_TTL_MS = 30_000;
// Keep the last successful payload this long as a failure fallback. A customer
// seeing slightly stale restaurants is strictly better than an error card —
// this is what keeps a transient edge/CORS/network blip off the home screen.
const PUBLIC_CATALOG_STALE_TTL_MS = 6 * 60 * 60_000;
// A hung request is worse than a failed one: mobile networks can hold a socket
// open indefinitely, and without this the home screen spins forever.
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

const UNREACHABLE_MESSAGE =
  'We could not reach our restaurants right now. Check your connection and try again.';
const GENERIC_FAILURE_MESSAGE = 'Something went wrong loading restaurants. Please try again.';

const publicCatalogCache = new Map<string, CacheEntry<unknown>>();
// Collapses concurrent callers (home shelf, favorites, restaurant detail) onto a
// single network round-trip instead of one request per screen.
const inFlightRequests = new Map<string, Promise<unknown>>();

const readFresh = <T>(key: string): T | null => {
  const entry = publicCatalogCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.freshUntil <= Date.now()) {
    return null;
  }

  return entry.value as T;
};

// Deliberately does NOT evict: an expired entry is still the best thing we can
// show if the network is down.
const readStale = <T>(key: string): T | null => {
  const entry = publicCatalogCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.staleUntil <= Date.now()) {
    publicCatalogCache.delete(key);
    return null;
  }

  return entry.value as T;
};

const writeCache = <T>(key: string, value: T) => {
  const now = Date.now();
  publicCatalogCache.set(key, {
    freshUntil: now + PUBLIC_CATALOG_FRESH_TTL_MS,
    staleUntil: now + PUBLIC_CATALOG_STALE_TTL_MS,
    value,
  });
};

class CatalogRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: { retryable: boolean; status?: number }) {
    super(message);
    this.name = 'CatalogRequestError';
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

// Retry transport faults and server faults only. A 4xx is a deterministic
// rejection — repeating it just delays the error the caller needs to see.
const isRetryableStatus = (status: number) => status >= 500 || status === 408 || status === 429;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const backoffDelayMs = (attempt: number) => {
  const exponential = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  // Jitter keeps a fleet of clients from retrying in lockstep after an outage.
  return exponential + Math.random() * RETRY_BASE_DELAY_MS;
};

const fetchWithTimeout = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CatalogRequestError(UNREACHABLE_MESSAGE, { retryable: true });
    }

    throw new CatalogRequestError(UNREACHABLE_MESSAGE, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
};

// Routes catalog reads through the Cloudflare edge cache (api.feasty.com.ng)
// when EXPO_PUBLIC_CATALOG_URL is set; response contract is identical to the
// Supabase function, so the result feeds the same envelope handling below.
const invokeViaEdgeCache = async <T>(
  action: string,
  data?: Record<string, unknown>
): Promise<T> => {
  const anonKey = supabaseEnv.anonKey ?? '';
  const response = await fetchWithTimeout(`${appEnv.catalogUrl}/public-catalog`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ action, data: data ?? {} }),
  });

  if (!response.ok) {
    throw new CatalogRequestError(
      response.status >= 500 ? UNREACHABLE_MESSAGE : GENERIC_FAILURE_MESSAGE,
      { retryable: isRetryableStatus(response.status), status: response.status }
    );
  }

  return (await response.json()) as T;
};

const invokeViaSupabase = async <T>(action: string, data?: Record<string, unknown>): Promise<T> => {
  const { data: responseData, error } = await supabase.functions.invoke<T>('public-catalog', {
    body: {
      action,
      data: data ?? {},
    },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response | undefined;
      const status = response?.status;

      throw new CatalogRequestError(
        status && status < 500 ? GENERIC_FAILURE_MESSAGE : UNREACHABLE_MESSAGE,
        { retryable: status ? isRetryableStatus(status) : true, status }
      );
    }

    if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
      throw new CatalogRequestError(UNREACHABLE_MESSAGE, { retryable: true });
    }

    throw new CatalogRequestError(GENERIC_FAILURE_MESSAGE, { retryable: false });
  }

  return responseData as T;
};

const unwrapEnvelope = <T>(responseData: unknown): T => {
  if (responseData && typeof responseData === 'object' && 'data' in responseData) {
    return (responseData as { data: T }).data;
  }

  return responseData as T;
};

const requestOnce = async <T>(action: string, data?: Record<string, unknown>): Promise<T> => {
  const responseData = appEnv.catalogUrl
    ? await invokeViaEdgeCache<T>(action, data)
    : await invokeViaSupabase<T>(action, data);

  return unwrapEnvelope<T>(responseData);
};

const requestWithRetries = async <T>(
  action: string,
  data?: Record<string, unknown>
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestOnce<T>(action, data);
    } catch (error) {
      lastError = error;

      const retryable = error instanceof CatalogRequestError ? error.retryable : false;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        break;
      }

      await delay(backoffDelayMs(attempt));
    }
  }

  throw lastError;
};

const callPublicCatalog = async <T>(action: string, data?: Record<string, unknown>) => {
  const cacheKey = `${action}:${JSON.stringify(data ?? {})}`;

  const fresh = readFresh<T>(cacheKey);
  if (fresh) {
    return fresh;
  }

  const existing = inFlightRequests.get(cacheKey) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const request = (async () => {
    try {
      const value = await requestWithRetries<T>(action, data);
      writeCache(cacheKey, value);
      return value;
    } catch (error) {
      // Last-known-good beats a dead end. Only when we have nothing cached at
      // all does the caller get an error to render.
      const stale = readStale<T>(cacheKey);
      if (stale) {
        return stale;
      }

      if (error instanceof Error && error.message.includes('Missing Supabase configuration value')) {
        throw new Error('Missing public catalog configuration. Check your Supabase runtime env and try again.');
      }

      throw error instanceof Error ? error : new Error(UNREACHABLE_MESSAGE);
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, request);
  return request;
};

export const getPublishedRestaurants = async () =>
  callPublicCatalog<{ restaurants: RestaurantDocument[] }>('customerGetPublishedRestaurants');

export const getPublishedRestaurantDetail = async (restaurantId: string) =>
  callPublicCatalog<{ restaurant: RestaurantDocument | null }>('customerGetPublishedRestaurantDetail', {
    restaurantId,
  });
