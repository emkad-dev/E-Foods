// Signing a user out of THIS device must always work, online or not.
//
// WHY THIS EXISTS. supabase-js's own signOut reads the session first, and with
// an expired access token that means refreshing it, which offline retries for
// ~25 s before failing -- and on failure it returns the error WITHOUT removing
// the stored session. So tapping "Sign out" offline blocked for ~97 s (getUser
// + signOut each waiting out the retries), ended with the user still signed in,
// and (the apps cleared the device id first) left a device id of null that the
// single-device rule then "adopts" instead of evicting.
//
// The rule now: ask the server for at most `SIGN_OUT_SERVER_TIMEOUT_MS`; if that
// fails, errors or hangs, remove the stored session ourselves. The server-side
// session simply expires on its own. The abandoned call is left running: if it
// ever gets the auth lock it signs out locally too, which is the same end state.
//
// The storage and key are read from the client's own GoTrueClient (`storage`,
// `storageKey`) instead of re-deriving `sb-<project-ref>-auth-token` here, so
// they can never disagree with where the client actually put the session.

export const SIGN_OUT_SERVER_TIMEOUT_MS = 5_000;

/** Bound on the best-effort "release my device id" write that precedes a sign-out. */
export const RELEASE_SESSION_TIMEOUT_MS = 3_000;

type StorageLike = {
  getItem: (key: string) => Promise<string | null> | string | null;
  removeItem: (key: string) => Promise<void> | void;
};

type SignOutClient = {
  auth: {
    signOut: (options: { scope: 'local' }) => Promise<{ error: unknown }>;
  };
};

// `storage` and `storageKey` are `protected` in auth-js's types but plain
// fields at runtime; this is the only place that reads them.
const readSessionStore = (supabase: unknown): { storage: StorageLike; key: string } | null => {
  const auth = (supabase as { auth?: { storage?: StorageLike; storageKey?: unknown } } | null)?.auth;
  if (!auth?.storage || typeof auth.storageKey !== 'string' || !auth.storageKey) {
    return null;
  }

  return { storage: auth.storage, key: auth.storageKey };
};

/** True when the client still has a session persisted (it may be expired). */
export const hasStoredSession = async (supabase: unknown): Promise<boolean> => {
  const store = readSessionStore(supabase);
  if (!store) {
    return false;
  }

  try {
    return Boolean(await store.storage.getItem(store.key));
  } catch {
    return false;
  }
};

const removeStoredSession = async (supabase: unknown) => {
  const store = readSessionStore(supabase);
  if (!store) {
    return;
  }

  // `-user` is where auth-js keeps the user when a separate userStorage is configured.
  for (const key of [store.key, `${store.key}-user`]) {
    try {
      await store.storage.removeItem(key);
    } catch {
      // Best effort: nothing more can be done from here.
    }
  }
};

/**
 * Runs best-effort work with an upper bound. Resolves with its value, or with
 * `undefined` if it throws or does not finish in time; the work is left running.
 */
export const bestEffortWithin = async <T>(work: () => Promise<T>, timeoutMs: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve().then(work).catch(() => undefined), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

/**
 * Ends this device's session. Never throws and never leaves the user signed in:
 * 'server' when supabase-js completed the sign-out, 'local-only' when the stored
 * session had to be removed by hand.
 */
export const signOutThisDevice = async (
  supabase: SignOutClient,
  { timeoutMs = SIGN_OUT_SERVER_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<'server' | 'local-only'> => {
  const result = await bestEffortWithin(() => supabase.auth.signOut({ scope: 'local' }), timeoutMs);

  if (result && !result.error) {
    return 'server';
  }

  await removeStoredSession(supabase);
  return 'local-only';
};
