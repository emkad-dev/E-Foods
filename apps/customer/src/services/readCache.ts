/**
 * Short-lived read cache for the customer's order reads, kept free of Expo and
 * Supabase imports so plain Node can test it (customerReadModel.ts cannot be
 * imported there).
 *
 * The cache exists to dedupe ordinary loads (tab flips, a second screen opening).
 * It must never hide a change the customer is waiting on: a realtime event, a
 * poll, a pull-to-refresh or a reload after the customer's own action asks for
 * `fresh`, which skips the cached copy and refreshes it.
 */

type Entry<T> = { expiresAt: number; seq: number; value: T };

export type ReadCacheOptions = {
  ttlMs: number;
  now?: () => number;
};

export type ReadCacheRequest = { fresh?: boolean };

export const createReadCache = ({ ttlMs, now = Date.now }: ReadCacheOptions) => {
  const entries = new Map<string, Entry<unknown>>();
  const inFlight = new Map<string, Promise<unknown>>();
  let counter = 0;
  // Requests started before the last clear() must not repopulate the cache: they
  // describe the world from before whatever the caller cleared for.
  let clearedAt = 0;

  const read = async <T>(
    key: string,
    fetcher: () => Promise<T>,
    { fresh = false }: ReadCacheRequest = {}
  ): Promise<T> => {
    if (!fresh) {
      const entry = entries.get(key) as Entry<T> | undefined;
      if (entry && entry.expiresAt > now()) {
        return entry.value;
      }
      // Join a request already on its way instead of firing a second one.
      const pending = inFlight.get(key) as Promise<T> | undefined;
      if (pending) {
        return pending;
      }
    }

    // A fresh call never joins an earlier request: that one may have left before
    // the change this call was triggered by, and no further load would follow.
    const seq = ++counter;
    const request = (async (): Promise<T> => {
      const value = await fetcher();
      const current = entries.get(key) as Entry<T> | undefined;
      if (current && current.seq > seq) {
        // A newer request already landed; an older response must not replace it
        // or be shown over it.
        return current.value;
      }
      if (seq > clearedAt) {
        entries.set(key, { expiresAt: now() + ttlMs, seq, value });
      }
      return value;
    })();

    inFlight.set(key, request);
    const release = () => {
      if (inFlight.get(key) === request) {
        inFlight.delete(key);
      }
    };
    request.then(release, release);
    return request;
  };

  const clear = () => {
    entries.clear();
    inFlight.clear();
    clearedAt = counter;
  };

  return { clear, read };
};
