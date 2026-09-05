/**
 * Transport-agnostic freshness cache + in-flight dedup for public-catalog
 * reads. Split out of publicRestaurantReadModel.ts so it can be unit tested
 * under plain Node (that file also imports expo-constants/@supabase/supabase-js,
 * which don't resolve outside Expo/Metro — see catalogCache.test.ts).
 *
 * Keying is the caller's responsibility (publicRestaurantReadModel.ts uses
 * `${action}:${JSON.stringify(data)}`), which is what makes the list read
 * (customerGetRestaurantList, no menu) and each restaurant's detail read
 * (customerGetRestaurantDetail:{"restaurantId":"<id>"}) live under distinct
 * keys — opening restaurant A never populates, touches, or evicts the entry
 * for restaurant B, and a restaurant that was never opened never gets an
 * entry at all.
 */

export type CacheEntry<T> = {
  // Younger than freshUntil: serve straight from memory, no network at all.
  freshUntil: number;
  // Younger than staleUntil: serve ONLY as last-known-good when the network fails.
  staleUntil: number;
  value: T;
};

export type CatalogCacheTtl = {
  freshMs: number;
  staleMs: number;
};

export type CatalogCacheStore = {
  entries: Map<string, CacheEntry<unknown>>;
  inFlight: Map<string, Promise<unknown>>;
};

export const createCatalogCacheStore = (): CatalogCacheStore => ({
  entries: new Map(),
  inFlight: new Map(),
});

const readFresh = <T>(store: CatalogCacheStore, key: string): T | null => {
  const entry = store.entries.get(key);
  if (!entry || entry.freshUntil <= Date.now()) {
    return null;
  }

  return entry.value as T;
};

// Deliberately does NOT evict: an expired entry is still the best thing we can
// show if the network is down.
const readStale = <T>(store: CatalogCacheStore, key: string): T | null => {
  const entry = store.entries.get(key);
  if (!entry) {
    return null;
  }

  if (entry.staleUntil <= Date.now()) {
    store.entries.delete(key);
    return null;
  }

  return entry.value as T;
};

const writeCache = <T>(store: CatalogCacheStore, key: string, value: T, ttl: CatalogCacheTtl) => {
  const now = Date.now();
  store.entries.set(key, {
    freshUntil: now + ttl.freshMs,
    staleUntil: now + ttl.staleMs,
    value,
  });
};

/**
 * Serve `key` from the fresh cache if possible; collapse concurrent callers
 * for the same key onto one in-flight `perform()`; on failure fall back to a
 * stale cached value (last-known-good) before letting the error through.
 */
export const callWithCache = async <T>(
  store: CatalogCacheStore,
  key: string,
  perform: () => Promise<T>,
  ttl: CatalogCacheTtl
): Promise<T> => {
  const fresh = readFresh<T>(store, key);
  if (fresh) {
    return fresh;
  }

  const existing = store.inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const request = (async () => {
    try {
      const value = await perform();
      writeCache(store, key, value, ttl);
      return value;
    } catch (error) {
      const stale = readStale<T>(store, key);
      if (stale) {
        return stale;
      }

      throw error;
    } finally {
      store.inFlight.delete(key);
    }
  })();

  store.inFlight.set(key, request);
  return request;
};
