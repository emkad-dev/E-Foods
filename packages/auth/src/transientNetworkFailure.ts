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
  | 'offline'
  /** The session turned out to be readable now: a later event will carry it. */
  | 'recovered';

type SessionLookupClient = {
  auth: {
    getSession: () => Promise<{ data: { session: unknown }; error: unknown }>;
  };
};

/**
 * What a null session means. supabase-js delivers INITIAL_SESSION with a null
 * session when it could not refresh the stored session -- including when the
 * phone is merely offline (the fetch fails, `getSession()` returns the error
 * and the stored session is left in place). Treating that as "signed out" wiped
 * the saved profile and the device id on every offline launch with an expired
 * access token, and a device that had been evicted while offline then
 * re-adopted the other device's id once the network came back.
 *
 * Only a SIGNED_OUT event, or an INITIAL_SESSION whose lookup finds no stored
 * session and no error, is a real sign-out. A dead refresh token is removed by
 * supabase-js itself (SIGNED_OUT), so the lookup reads it as no session / not
 * transient and the existing sign-out path is unchanged.
 */
export const resolveNullSessionOutcome = async (
  supabase: SessionLookupClient,
  event: string
): Promise<NullSessionOutcome> => {
  if (event !== 'INITIAL_SESSION') {
    return 'signed-out';
  }

  let lookup: { data: { session: unknown } | null; error: unknown };
  try {
    lookup = await supabase.auth.getSession();
  } catch (error) {
    lookup = { data: null, error };
  }

  if (lookup.data?.session) {
    return 'recovered';
  }

  return lookup.error && isTransientNetworkFailure(lookup.error) ? 'offline' : 'signed-out';
};
