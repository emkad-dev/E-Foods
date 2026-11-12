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

import { hasStoredSession } from './localSignOut.ts';
import { isNetworkRequestError } from './networkRequestError.ts';

// boundedFetch's AbortController abort. The wording differs by runtime
// (Hermes/Node/browsers) and by who wraps it: supabase-js rewraps it as an
// AuthRetryableFetchError, PostgREST prefixes the error name ("AbortError: ...").
//
// Also the web lock's own execution bound (sessionLock.ts, 50 s): calls queued
// inside one holder while offline can each wait out a refresh, and the resulting
// 'Supabase auth lock "..." did not resolve within 50000ms.' is the same stalled
// network seen from a different layer.
const TIMEOUT_MESSAGE_PATTERNS = ['aborted', 'aborterror', 'timed out', 'timeout', 'did not resolve within'];

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
  // 'NetworkError' is what callBackendRpc throws on any transport failure: a read
  // whose direct call and relay both could not reach the server ("Backend RPC x
  // failed: Failed to send a request to the Edge Function"), or a write whose
  // direct call failed and which is deliberately not re-sent through the relay
  // (the raw fetch message). No message pattern covers all of those wordings.
  // 'TimeoutError' is its overall-deadline expiry. Browsers also use both names
  // for dropped and timed-out requests.
  if (name === 'AbortError' || name === 'AuthRetryableFetchError' || name === 'NetworkError' || name === 'TimeoutError') {
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

/**
 * Runs `operation`, and runs it once more if it failed with a transient network
 * failure (no signal, a dropped or stalled connection). Anything else, including
 * a server rejection, propagates from the first attempt untouched.
 *
 * Only for requests that are safe to send twice. NEVER wrap a refresh-token
 * request in this: refresh tokens rotate, so a second send after a first that
 * did reach the server can burn the session.
 */
export const retryOnceOnTransientFailure = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    // A response is an answer. A BackendRpcError means the server replied, and a
    // server message can contain words ("timeout") the classifier below would
    // read as a dead connection. Structural check, as isBackendRpcError does:
    // this module must not import backendRpc.
    if (readString(error, 'name') === 'BackendRpcError' || !isTransientNetworkFailure(error)) {
      throw error;
    }

    return operation();
  }
};

export type ProfileLoadFailureOutcome =
  /** Show the saved profile; the account is fine, only the reload failed. */
  | 'keep-cached-user'
  /**
   * Nothing usable saved: report no-internet, and neither sign out nor write a
   * stand-in profile. The caller decides what (if anything) is on screen
   * meanwhile -- partner/dispatch show their login with the error, customer
   * leaves its state alone -- but the Supabase session and storage stay as they
   * are so the next reconcile that reaches the server can sign them in.
   */
  | 'offline-without-profile'
  /** A genuine failure: the app's existing error handling applies. */
  | 'fail';

/**
 * What to do when reloading the signed-in user's profile throws. The decision
 * is pure so the rule "a network failure never looks like being signed out" is
 * covered by a test rather than by three hand-copied catch blocks.
 *
 * `hasUsableCachedProfile` is the caller's own judgement that the saved profile
 * belongs to this auth user (and, per app, has an acceptable role). It is a
 * plain boolean on purpose: what counts as usable differs per app, the rule
 * about what a network failure may and may not do does not.
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

export type NullSessionOutcome =
  /** Really signed out (or never signed in): clear local state. */
  | 'signed-out'
  /** The session is stored but could not be refreshed (offline/stalled): keep saved state. */
  | 'offline';

/**
 * What a null session means. supabase-js delivers INITIAL_SESSION with a null
 * session when it could not refresh the stored session -- including when the
 * phone is merely offline. Treating that as "signed out" wiped the saved
 * profile and the device id on every offline launch with an expired access
 * token, and a device that had been evicted while offline then re-adopted the
 * other device's id once the network came back.
 *
 * The signal is the stored session itself: auth-js removes it on any
 * NON-retryable refresh error (a dead refresh token also emits SIGNED_OUT) and
 * leaves it in place on a retryable one. So INITIAL_SESSION + null + a stored
 * session = offline; nothing stored = signed out. It is read from storage, not
 * via a second `getSession()`: that call waits on the auth lock, which stays
 * busy for as long as the device is offline (measured 172 s+ with auto refresh
 * on), and its stale answer then landed after the network was back.
 */
export const resolveNullSessionOutcome = async (
  supabase: unknown,
  event: string
): Promise<NullSessionOutcome> => {
  if (event !== 'INITIAL_SESSION') {
    return 'signed-out';
  }

  return (await hasStoredSession(supabase)) ? 'offline' : 'signed-out';
};
