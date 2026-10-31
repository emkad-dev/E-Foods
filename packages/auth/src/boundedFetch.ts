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

/** Factory so tests can use a short timeout instead of waiting out the real one. */
export const createBoundedFetch =
  (timeoutMs: number): typeof fetch =>
  (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

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
export const boundedFetch: typeof fetch = createBoundedFetch(FETCH_TIMEOUT_MS);
