/**
 * WHY THIS EXISTS. The actual root cause behind "Submit does nothing,
 * forever, with zero error" (see sessionLock.ts for the full chain) turned
 * out to be one level deeper than the lock itself: GoTrueClient's internal
 * HTTP calls (session refresh, sign-in, ...) use a plain `fetch` with no
 * timeout of its own. If one of those calls is interrupted in a way that
 * leaves it neither resolved nor rejected (a dev-server restart cutting the
 * connection mid-flight, a stalled connection the OS never gives up on),
 * the promise GoTrueClient is awaiting inside its lock never settles.
 *
 * That matters even with sessionLock.ts's bounded lock in place: the lock
 * wrapper can time out the PROMISE IT awaits and let a new caller proceed,
 * but it cannot reach into GoTrueClient's own internal bookkeeping. GoTrueClient
 * sets `this.lockAcquired = true` before running its operation and only sets
 * it back to `false` in that same operation's own `finally` block, once *it*
 * settles -- not when our wrapper's timeout gives up on waiting for it. If the
 * underlying fetch never settles, that `finally` never runs, `lockAcquired`
 * stays `true` forever, and every *subsequent* call in that same tab bypasses
 * the lock wrapper entirely via GoTrueClient's own in-process
 * `pendingInLock` queue -- which has no timeout anywhere. Confirmed directly:
 * after poisoning a cross-tab lock and letting a fresh page's first session
 * call hang, `client.auth.lockAcquired` read back `true` with five queued
 * operations behind it, long after the lock wrapper's own timeouts should
 * have long since fired.
 *
 * The fix belongs at the actual source: give every one of GoTrueClient's own
 * fetch calls a hard timeout, so the promise it's running inside the lock
 * ALWAYS settles within a bounded time on its own, which lets its own
 * `finally` reset `lockAcquired` correctly -- no permanently orphaned
 * in-process state, no need for the lock wrapper's recovery path to even be
 * exercised in this scenario at all.
 */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Password sign-in is the one request a person is staring at, and it either
 * answers in a couple of seconds or is not going to. 15s of spinner before the
 * single retry (see signInWithEmail) made a stalled connection feel like a hung
 * app, so it fails at 7s and is sent once more.
 */
export const PASSWORD_GRANT_TIMEOUT_MS = 7_000;

// `URL` is spelled out because React Native's fetch typings omit it from RequestInfo.
type FetchInput = Parameters<typeof fetch>[0] | URL;

const requestUrlOf = (input: FetchInput): string => {
  if (typeof input === 'string') {
    return input;
  }

  if (typeof URL !== 'undefined' && input instanceof URL) {
    return input.href;
  }

  return typeof (input as { url?: unknown })?.url === 'string' ? (input as { url: string }).url : '';
};

/**
 * The time limit for one request, decided from its URL alone so the policy is
 * testable without a network. Only the password grant is shortened. A
 * refresh-token request deliberately keeps the full limit: refresh tokens
 * rotate, so cutting one off client-side after the server has already accepted
 * it (and never retrying it, which would present a spent token) can lose the
 * session. Everything else keeps the limit the stalled-lock fix was built on.
 */
export const resolveFetchTimeoutMs = (input: FetchInput): number => {
  const url = requestUrlOf(input);

  // GoTrue addresses the grant type in the query string of /token.
  if (/\/auth\/v1\/token\?(?:[^#]*&)?grant_type=password(?:&|#|$)/.test(url)) {
    return PASSWORD_GRANT_TIMEOUT_MS;
  }

  return FETCH_TIMEOUT_MS;
};

/**
 * Factory so tests can use a short timeout instead of waiting out the real one.
 * A number is one limit for every request; a function is asked per request.
 */
export const createBoundedFetch =
  (timeoutMs: number | ((input: FetchInput) => number)): typeof fetch =>
  (input, init) => {
    const controller = new AbortController();
    const limitMs = typeof timeoutMs === 'function' ? timeoutMs(input) : timeoutMs;
    const timer = setTimeout(() => controller.abort(), limitMs);

    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
    });
  };

/**
 * Wraps the global `fetch` with a hard timeout. Pass as
 * `createClient(url, key, { global: { fetch: boundedFetch } })` -- NOT
 * `auth: { fetch }`; GoTrueClient's own fetch comes from the client's
 * top-level `global.fetch` option, not an `auth`-scoped one.
 */
export const boundedFetch: typeof fetch = createBoundedFetch(resolveFetchTimeoutMs);
