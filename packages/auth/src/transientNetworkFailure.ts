// One definition of "the network failed, not the account", shared by the
// customer, partner and dispatch AuthContexts.
//
// WHY THIS EXISTS. Each app used to decide "offline" with its own copy of a
// check that only looked for the word "offline" (a leftover from the Firestore
// era). A real dropped connection says "Network request failed" (React Native)
// or "Failed to fetch" (web), and a stalled one is aborted by boundedFetch after
// 15s with "Aborted" / "The operation was aborted". None matched, so partner and
// dispatch fell through to `setUser(null)` + `clearStoredUserProfile()` and the
// rider/restaurant was dropped at the login screen just because the signal
// dipped while the app reloaded their profile.

import { isNetworkRequestError } from './supabaseAuth.ts';

// boundedFetch's AbortController abort. The wording differs by runtime
// (Hermes/Node/browsers) and by who wraps it: supabase-js rewraps it as an
// AuthRetryableFetchError, PostgREST prefixes the error name ("AbortError: ...").
const TIMEOUT_MESSAGE_PATTERNS = ['aborted', 'aborterror', 'timed out', 'timeout'];

const readString = (error: unknown, key: 'code' | 'message' | 'name') =>
  typeof error === 'object' && error !== null && key in error
    ? String((error as Record<string, unknown>)[key] ?? '')
    : '';

const isOfflineSignal = (error: unknown) => {
  const code = readString(error, 'code');
  const message = readString(error, 'message').toLowerCase();

  return (
    code === 'unavailable' ||
    code === 'failed-precondition' ||
    message.includes('client is offline') ||
    message.includes('offline')
  );
};

const isTimeoutSignal = (error: unknown) => {
  const name = readString(error, 'name');
  if (name === 'AbortError' || name === 'AuthRetryableFetchError') {
    return true;
  }

  const message = readString(error, 'message').toLowerCase();
  return TIMEOUT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
};

/**
 * True when the error says the request never got a real answer (no signal, a
 * dropped or stalled connection) rather than the server saying no. A stale
 * refresh token or a permission error is NOT transient and must keep its own
 * handling.
 */
export const isTransientNetworkFailure = (error: unknown) =>
  isOfflineSignal(error) || isNetworkRequestError(error) || isTimeoutSignal(error);

export type ProfileLoadFailureOutcome =
  /** Show the saved profile; the account is fine, only the reload failed. */
  | 'keep-cached-user'
  /** Nothing saved to show: report no-internet but leave the Supabase session alone. */
  | 'offline-without-profile'
  /** A genuine failure: the app's existing error handling applies. */
  | 'fail';

/**
 * What to do when reloading the signed-in user's profile throws. The decision
 * is pure so the rule "a network failure never looks like being signed out" is
 * covered by a test rather than by three hand-copied catch blocks.
 *
 * `hasUsableCachedProfile` is the caller's own judgement that the saved profile
 * belongs to this auth user (and, per app, has an acceptable role).
 */
export const resolveProfileLoadFailure = ({
  error,
  hasAuthUser,
  hasUsableCachedProfile,
}: {
  error: unknown;
  hasAuthUser: boolean;
  hasUsableCachedProfile: boolean;
}): ProfileLoadFailureOutcome => {
  if (!hasAuthUser || !isTransientNetworkFailure(error)) {
    return 'fail';
  }

  return hasUsableCachedProfile ? 'keep-cached-user' : 'offline-without-profile';
};
