import { navigatorLock } from '@supabase/auth-js';

/**
 * WHY THIS EXISTS. Supabase's web client serializes every session call
 * (getSession, signIn, refreshSession, ...) behind one browser-wide
 * `navigator.locks` lock per project, shared across every tab on the origin.
 * The library's own `lockAcquireTimeout` (default 5s) only bounds how long a
 * NEW caller waits to acquire that lock — once acquired, nothing times out
 * the operation running inside it. If that operation's own network call
 * never settles (an interrupted request, a dev-server restart cutting the
 * connection mid-flight, a stalled connection the OS never gives up on),
 * the lock is held forever, and every future session call anywhere on that
 * origin queues behind it and hangs silently forever too — no error, no
 * rejected promise, no network request, nothing for the UI to react to. A
 * submit button whose handler awaits `getSession()` first just sits there
 * looking dead.
 *
 * The installed @supabase/auth-js version already self-heals the LOCK
 * handoff (a new caller that times out waiting steals the lock and retries
 * fn() itself — see its own lib/locks.js) but that only recovers who HOLDS
 * the lock, not how long holding it can take: if fn() itself is the thing
 * that never resolves, every successive holder re-hangs on the same stuck
 * operation.
 *
 * `boundedNavigatorLock` wraps the library's real `navigatorLock` (reusing
 * its correct acquire/queue/steal behavior untouched) and adds a second,
 * independent timeout around the operation *running inside* the lock. If it
 * doesn't settle within `LOCK_EXECUTION_TIMEOUT_MS`, this rejects instead of
 * hanging — which lets the real Web Lock release immediately (per spec, a
 * lock releases as soon as its callback's promise settles, whether resolved
 * or rejected) so the next caller can proceed, and lets our own calling code
 * (packages/auth/src/backendRpc.ts, every AuthContext) get a timely error to
 * show instead of an infinite, silent hang. The orphaned original operation
 * keeps running unawaited in the background if it ever does complete — the
 * same trade-off the library's own steal-recovery path already makes
 * deliberately, not a new risk this introduces.
 */
export const LOCK_EXECUTION_TIMEOUT_MS = 10_000;

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

/** Drop-in replacement for `@supabase/auth-js`'s `navigatorLock` — same
 * signature, same acquire/queue/steal behavior, plus the execution bound
 * described above. Pass as `createClient(url, key, { auth: { lock } })`.
 */
export const boundedNavigatorLock = <R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> =>
  navigatorLock(name, acquireTimeout, () =>
    withExecutionTimeout(fn, LOCK_EXECUTION_TIMEOUT_MS, `Supabase auth lock "${name}"`)
  );
