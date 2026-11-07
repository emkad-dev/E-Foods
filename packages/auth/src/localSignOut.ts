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
// WHY IT NEVER CALLS auth.signOut. That call queues on the auth lock, reads the
// session from storage when it finally runs, posts /logout, then wipes whatever
// is stored and emits SIGNED_OUT. signInWithPassword takes no lock. So a sign-out
// abandoned on a stalled network could return after the user had signed back in
// and delete the NEW session; with an expired token or a busy queue it read the
// new token and revoked that on the server as well.
//
// The rule now: read the stored access token once, ask the server to revoke
// exactly that token for at most `SIGN_OUT_SERVER_TIMEOUT_MS`, then remove the
// stored session ourselves whatever the answer. No lock and no refresh. A late
// answer has nothing waiting on it, and the request can only ever name the old
// session. If the server was not reached, or the token had already expired, the
// server-side session simply expires on its own.
//
// COST: no SIGNED_OUT fires on this path. Every caller clears its own state
// directly, and the realtime socket is handled below. Other tabs of the web apps
// are not told; they find out on their next auth call.
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
    admin: {
      signOut: (jwt: string, scope: 'local') => Promise<{ error: unknown }>;
    };
  };
  realtime?: {
    setAuth: () => Promise<void>;
  };
};

// The answers auth-js itself treats as "already signed out" in its own _signOut:
// an invalid or expired JWT (401/403), a user that no longer exists (404), and
// the server's session_not_found, which it rewrites to AuthSessionMissingError
// with status 400.
const SESSION_ALREADY_GONE_STATUSES = new Set([401, 403, 404]);

const isSessionAlreadyGone = (error: unknown) => {
  const { name, status } = (error ?? {}) as { name?: unknown; status?: unknown };
  return name === 'AuthSessionMissingError' || SESSION_ALREADY_GONE_STATUSES.has(status as number);
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

const readStoredAccessToken = async (supabase: unknown): Promise<string | null> => {
  const store = readSessionStore(supabase);
  if (!store) {
    return null;
  }

  try {
    const stored = await store.storage.getItem(store.key);
    const accessToken = stored ? (JSON.parse(stored) as { access_token?: unknown }).access_token : null;
    return typeof accessToken === 'string' && accessToken ? accessToken : null;
  } catch {
    // Unreadable or malformed: nothing to revoke, and the removal still runs.
    return null;
  }
};

const removeStoredSession = async (supabase: unknown) => {
  const store = readSessionStore(supabase);
  if (!store) {
    return;
  }

  // The same keys auth-js's own _removeSession clears. `-user` is where it keeps
  // the user when a separate userStorage is configured.
  for (const key of [store.key, `${store.key}-code-verifier`, `${store.key}-user`]) {
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
 * Moves the realtime socket off the old JWT, which is what supabase-js does on
 * SIGNED_OUT. It pinned that JWT at sign-in, so nothing else replaces it, and once
 * it expires the server drops the channels a guest still uses (the public promo
 * topic). Not awaited: this reads the session through the auth lock, and the
 * session is already gone from storage, so it resolves to the anon key whenever
 * the lock comes free.
 */
const releaseRealtimeToken = (supabase: SignOutClient) => {
  void Promise.resolve()
    .then(() => supabase.realtime?.setAuth())
    .catch(() => undefined);
};

/**
 * Ends this device's session. Never throws and never leaves the user signed in.
 * 'server' when the server confirmed the session is over, 'local-only' when it
 * could not be asked or did not answer in time. The stored session is removed
 * either way, and only once, before this returns.
 */
export const signOutThisDevice = async (
  supabase: SignOutClient,
  { timeoutMs = SIGN_OUT_SERVER_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<'server' | 'local-only'> => {
  // Bounded separately from the request so a slow read that finishes after the
  // limit has nothing waiting on it, and cannot pick up a newer session's token.
  const accessToken = await bestEffortWithin(() => readStoredAccessToken(supabase), timeoutMs);
  const result = accessToken
    ? await bestEffortWithin(() => supabase.auth.admin.signOut(accessToken, 'local'), timeoutMs)
    : undefined;

  await removeStoredSession(supabase);
  releaseRealtimeToken(supabase);

  return result && (!result.error || isSessionAlreadyGone(result.error)) ? 'server' : 'local-only';
};
