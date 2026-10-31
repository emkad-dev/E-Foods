/**
 * WHY THIS EXISTS. Supabase's web client serializes every session call
 * (getSession, signIn, refreshSession, ...) behind one browser-wide
 * `navigator.locks` lock per project, shared across every tab on the origin.
 * The library's own `lockAcquireTimeout` (default 5s) is documented to bound
 * how long a new caller waits before stealing an orphaned lock -- but
 * directly verified against the installed @supabase/auth-js build in this
 * app (via repeated, controlled two-tab reproductions: one tab holds the
 * lock forever, the other navigates fresh against it), that recovery never
 * fires. The library's own unconditional `console.warn` for "lock was not
 * released within Xms" never appears either, confirming the acquire-timeout
 * path genuinely never triggers in this bundle -- not just a change that's
 * hard to observe. Whatever the exact cause (a bundler/transform
 * interaction, a version mismatch between the dist file read from disk and
 * what Metro resolves, something else), relying on it was not an option.
 *
 * Instead of wrapping the library's `navigatorLock`, this reimplements the
 * same contract directly on the raw Web Locks + AbortController primitives,
 * which WERE directly verified to behave correctly in this app's actual
 * runtime (an aborted in-flight `navigator.locks.request` rejects with
 * AbortError right on schedule). Two independent timeouts:
 *
 *  - ACQUIRE timeout: if the lock can't be granted within `acquireTimeout`
 *    ms, abort the wait and forcefully steal it (`{ steal: true }`), exactly
 *    as the Web Locks spec intends that option to be used to recover from an
 *    orphaned holder.
 *  - EXECUTION timeout: once granted, the operation running inside the lock
 *    (`fn`) is also bounded, so a holder whose own work hangs (e.g. a
 *    network call that never settles) can't re-poison the lock for the next
 *    caller either. A Web Lock releases as soon as its callback's promise
 *    settles, resolved or rejected, so timing this out frees it immediately;
 *    the orphaned `fn()` keeps running unawaited if it ever does finish,
 *    which is the same trade-off the Web Locks spec's own `steal` option
 *    already makes for the lock-holder case.
 *
 * Net effect: a call through this lock can take at most roughly
 * `acquireTimeout + LOCK_EXECUTION_TIMEOUT_MS`, never forever, regardless of
 * what state a previous call left the lock in -- which is what turns "the
 * Submit button does nothing, forever, with zero error" into "it fails
 * within a bounded, short time with a real error the UI can show."
 */
export const LOCK_EXECUTION_TIMEOUT_MS = 10_000;

/**
 * GoTrueClient is supposed to pass its own `lockAcquireTimeout` (library
 * default 5s) as `acquireTimeout` on every call -- but directly observed in
 * this app's live console, it actually arrives as `undefined`
 * (`Object.assign` merging an explicitly-`undefined` key over
 * DEFAULT_OPTIONS' 5000 inside @supabase/supabase-js's own options wiring
 * when the caller never sets `lockAcquireTimeout` -- which this app never
 * does). `undefined > 0` is `false`, so the real `acquireTimeout <= 0` check
 * below never caught it either: it fell through to `setTimeout(fn,
 * undefined)`, which browsers run at effectively 0ms, firing the abort
 * almost immediately and producing a storm of near-instant steal attempts
 * racing each other instead of one orderly wait-then-recover. This is
 * presumably also why wrapping the library's own `navigatorLock` (the
 * approach this file used before) never visibly recovered: its own
 * acquire-timeout arm was never armed for the same reason, the exact same
 * `undefined` reaching it unguarded.
 */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;

const resolveAcquireTimeout = (acquireTimeout: number): number =>
  Number.isFinite(acquireTimeout) ? acquireTimeout : DEFAULT_ACQUIRE_TIMEOUT_MS;

/**
 * Races `fn` against a timeout that rejects after `timeoutMs`. Pure and
 * browser-API-free so it is unit-testable without `navigator.locks`.
 */
export const withExecutionTimeout = <R>(fn: () => Promise<R>, timeoutMs: number, label: string): Promise<R> =>
  new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} did not resolve within ${timeoutMs}ms.`));
    }, timeoutMs);

    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError';

/**
 * Drop-in for `@supabase/auth-js`'s `LockFunc` signature
 * (`(name, acquireTimeout, fn) => Promise<R>`) -- pass as
 * `createClient(url, key, { auth: { lock } })`. See the module doc above for
 * why this exists instead of using the library's own `navigatorLock`.
 */
export const boundedNavigatorLock = <R>(name: string, rawAcquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  const acquireTimeout = resolveAcquireTimeout(rawAcquireTimeout);
  const boundedFn = () => withExecutionTimeout(fn, LOCK_EXECUTION_TIMEOUT_MS, `Supabase auth lock "${name}"`);

  // `ifAvailable` is the one mode where a `null` lock is spec'd and expected
  // (means "wasn't free"), so only that path treats it as a real failure.
  // Every other mode (plain wait, steal) grants a real lock whenever the
  // callback runs at all; tolerating a defensively-null one there too (run
  // `boundedFn` anyway) avoids turning an extremely unlikely edge case into
  // an unhandled rejection some fire-and-forget internal caller never catches.
  const requestOnce = (options: LockOptions, treatNullAsFailure: boolean) =>
    navigator.locks.request(name, options, (lock) => {
      if (!lock && treatNullAsFailure) {
        throw new Error(`Lock "${name}" was not granted.`);
      }
      return boundedFn();
    }) as Promise<R>;

  if (acquireTimeout <= 0) {
    // 0 (or negative, treated the same here): no waiting -- matches the
    // library's own "fail fast if unavailable" contract for 0.
    return requestOnce({ mode: 'exclusive', ifAvailable: true }, true);
  }

  const abortController = new AbortController();
  const acquireTimer = setTimeout(() => abortController.abort(), acquireTimeout);

  return requestOnce({ mode: 'exclusive', signal: abortController.signal }, false).then(
    (value) => {
      clearTimeout(acquireTimer);
      return value;
    },
    async (error) => {
      clearTimeout(acquireTimer);

      if (!isAbortError(error) || !abortController.signal.aborted) {
        throw error;
      }

      // Our own acquire-timeout fired while still queued: the current
      // holder is orphaned (or just slow past our patience). Forcefully
      // take the lock rather than wait on it further.
      console.warn(
        `@ebuy/auth: lock "${name}" was not granted within ${acquireTimeout}ms; stealing it to recover.`
      );
      return requestOnce({ mode: 'exclusive', steal: true }, false);
    }
  );
};
