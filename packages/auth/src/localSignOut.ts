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
// sign-out does not revoke on the server: only this device's copy is deleted, and
// refresh tokens do not expire by default, so that server session stays usable by
// anyone already holding a copy of its refresh token.
//
// COST: no SIGNED_OUT fires on this path. Every caller clears its own state
// directly, a reconcile already running is stopped by isReconcileStillValid, and
// the realtime socket is handled below. Other tabs of the web apps are not told;
// they find out on their next auth call.
//
// COST: not waiting on the lock means a refresh already running keeps going, and
// its result would write the session back. See sweepRefreshWriteBack.
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

const readJwtSubject = (token: unknown): string | null => {
  const payload = typeof token === 'string' ? token.split('.')[1] : null;
  if (!payload) {
    return null;
  }

  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const { sub } = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { sub?: unknown };
  return typeof sub === 'string' && sub ? sub : null;
};

/**
 * Whether a reconcile for `session` may still touch app state. No SIGNED_OUT
 * follows a sign-out any more, so nothing queues behind a reconcile that is
 * already running: without this, a profile read returning after the sign-out puts
 * the user back on screen with no stored session.
 *
 * Reads storage directly, because the auth lock can be busy for as long as the
 * device is offline. Compares user ids, never access tokens: a refresh rotates the
 * token mid-reconcile, and that must not discard a good result.
 *
 * auth-js stores `user` in the main record unless a userStorage is configured (this
 * repo configures none), in which case it lives under `-user`. The access token is
 * always in the main record, so its `sub` covers that case without a second read.
 *
 * Only a stored session that is missing or names someone else is stale. Anything
 * that cannot be read counts as valid, so a storage hiccup never drops a user.
 */
export const isReconcileStillValid = async (
  supabase: unknown,
  session: { user?: { id?: string } | null } | null | undefined
): Promise<boolean> => {
  const userId = session?.user?.id;
  const store = readSessionStore(supabase);
  if (!userId || !store) {
    return true;
  }

  try {
    const stored = await store.storage.getItem(store.key);
    if (!stored) {
      return false;
    }

    const parsed = JSON.parse(stored) as { user?: { id?: unknown } | null; access_token?: unknown };
    const storedUserId = typeof parsed.user?.id === 'string' ? parsed.user.id : readJwtSubject(parsed.access_token);
    return storedUserId === null || storedUserId === userId;
  } catch {
    return true;
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
 * Undoes a refresh that outlives the sign-out. The usual case: expired token,
 * offline, and the steps before the sign-out start or join a refresh and are
 * abandoned. If the network returns inside the retry window, auth-js writes the
 * session back and emits TOKEN_REFRESHED, signing the user in again with a live
 * server session, which matters on a shared phone.
 *
 * `refreshingDeferred` is `protected` in auth-js's types, like `storage`; the
 * localSignOut test runs this against the real client so a rename cannot go
 * unnoticed. Its promise settles only after the write and the event, so whatever
 * is stored by then is final for that refresh. The token comparison leaves a newer
 * sign-in alone. Not awaited: this can take as long as the refresh does.
 *
 * A removal here emits SIGNED_OUT, also private and also pinned by that test. The
 * write-back may have replaced a sign-in made after the sign-out, and that user is
 * still on screen with every action failing. The event takes them through the
 * app's null-session path, and supabase-js's own handler resets the realtime socket.
 */
const sweepRefreshWriteBack = (supabase: SignOutClient) => {
  const auth = supabase.auth as {
    refreshingDeferred?: { promise?: PromiseLike<unknown> } | null;
    _notifyAllSubscribers?: (event: 'SIGNED_OUT', session: null) => Promise<void>;
  };
  const inFlight = auth.refreshingDeferred?.promise;
  if (!inFlight) {
    return;
  }

  void Promise.resolve(inFlight)
    .then(async (result) => {
      const accessToken = (result as { data?: { access_token?: unknown } | null } | null)?.data?.access_token;
      if (typeof accessToken !== 'string' || (await readStoredAccessToken(supabase)) !== accessToken) {
        return;
      }

      await removeStoredSession(supabase);

      try {
        await auth._notifyAllSubscribers?.('SIGNED_OUT', null);
      } catch {
        // auth-js rethrows a listener's error. The revoke below must still go out.
      }

      await supabase.auth.admin.signOut(accessToken, 'local');
    })
    .catch(() => undefined);
};

/**
 * Ends this device's session. Never throws and never leaves the user signed in.
 * 'server' when the server confirmed the session is over, 'local-only' when it
 * could not be asked or did not answer in time. The stored session is removed
 * either way before this returns, and again only if a refresh still running
 * writes it back.
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
  sweepRefreshWriteBack(supabase);
  releaseRealtimeToken(supabase);

  return result && (!result.error || isSessionAlreadyGone(result.error)) ? 'server' : 'local-only';
};
