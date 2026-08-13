import type { RestaurantDocument } from '../domain/entities';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { supabase } from './supabase/config';
import { appEnv, supabaseEnv } from '../config/env';
import { callWithCache, createCatalogCacheStore, type CatalogCacheTtl } from './catalogCache';

// Serve without touching the network for this long.
const PUBLIC_CATALOG_FRESH_TTL_MS = 30_000;
// Keep the last successful payload this long as a failure fallback. A customer
// seeing slightly stale restaurants is strictly better than an error card —
// this is what keeps a transient edge/CORS/network blip off the home screen.
const PUBLIC_CATALOG_STALE_TTL_MS = 6 * 60 * 60_000;
const CATALOG_CACHE_TTL: CatalogCacheTtl = {
  freshMs: PUBLIC_CATALOG_FRESH_TTL_MS,
  staleMs: PUBLIC_CATALOG_STALE_TTL_MS,
};
// A hung request is worse than a failed one: mobile networks can hold a socket
// open indefinitely, and without this the home screen spins forever.
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

const UNREACHABLE_MESSAGE =
  'We could not reach our restaurants right now. Check your connection and try again.';
const GENERIC_FAILURE_MESSAGE = 'Something went wrong loading restaurants. Please try again.';

// Keyed per `${action}:${JSON.stringify(data)}` (see callPublicCatalog below),
// so the card list and each restaurant's detail live under distinct entries.
const catalogCacheStore = createCatalogCacheStore();

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

  try {
    // callWithCache already falls back to a stale cached value on failure
    // (last-known-good beats a dead end); only when there is nothing cached
    // at all does its rejection reach this catch.
    return await callWithCache<T>(catalogCacheStore, cacheKey, () => requestWithRetries<T>(action, data), CATALOG_CACHE_TTL);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing Supabase configuration value')) {
      throw new Error('Missing public catalog configuration. Check your Supabase runtime env and try again.');
    }

    throw error instanceof Error ? error : new Error(UNREACHABLE_MESSAGE);
  }
};

// Deprecated: full catalog incl. every restaurant's menu, one request. Kept
// only for apps/customer/app/(customer)/search.tsx's meal search, which
// genuinely needs every menu to search across restaurants — there is no
// server-side meal search yet, so this stays the one caller. Do not add new
// callers; use getRestaurantList (cards) + getRestaurantDetail (by id)
// instead, which is what the home feed, cart, and restaurant screen now do.
export const getPublishedRestaurants = async () =>
  callPublicCatalog<{ restaurants: RestaurantDocument[] }>('customerGetPublishedRestaurants');

/**
 * Restaurant cards for discovery: id/name/cuisine/pricing/location fields,
 * no `menu`. Pass `coords` to filter to restaurants whose delivery radius
 * covers that point, nearest-first; omit it for the default updatedAt-DESC
 * order. Paginated (`cursor` in, `nextCursor` out); callers that want the
 * whole list page through it themselves.
 */
export const getRestaurantList = async (params?: {
  latitude?: number;
  longitude?: number;
  cursor?: string;
}) =>
  callPublicCatalog<{ restaurants: RestaurantDocument[]; nextCursor: string | null }>(
    'customerGetRestaurantList',
    params as Record<string, unknown> | undefined
  );

/** One restaurant (incl. priced menu), fetched by id — never a full-catalog scan. */
export const getRestaurantDetail = async (restaurantId: string) =>
  callPublicCatalog<{ restaurant: RestaurantDocument | null }>('customerGetRestaurantDetail', {
    restaurantId,
  });
