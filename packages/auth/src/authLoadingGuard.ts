import type { AuthChangeEvent } from '@supabase/supabase-js';

type ShouldShowSignInLoadingArgs = {
  /** The event Supabase's onAuthStateChange callback received. */
  event: AuthChangeEvent;
  /**
   * Whether a user was already present in this context's state *before* this
   * event arrived. Read from a ref (not the `user` state value captured by
   * the closure) so a stale render never masks a real transition.
   */
  hasUser: boolean;
};

/**
 * Decides whether an auth-state-change event should re-enter the app's
 * full-screen loading state.
 *
 * Supabase re-emits `SIGNED_IN` when a browser tab (or a backgrounded native
 * app) regains focus for a user who is already signed in -- that is a
 * session *rehydration*, not an interactive sign-in, and must reconcile
 * silently in the background. A genuine interactive sign-in also reports
 * `SIGNED_IN`, but arrives with no user yet present. The two are
 * indistinguishable by event name alone; the distinguishing signal is prior
 * user presence, not the event name.
 *
 * Every other event (`TOKEN_REFRESHED`, `INITIAL_SESSION`, `SIGNED_OUT`,
 * `USER_UPDATED`, `PASSWORD_RECOVERY`, `MFA_CHALLENGE_VERIFIED`) is always
 * background reconciliation and never blocks the UI.
 */
export const shouldShowSignInLoading = ({ event, hasUser }: ShouldShowSignInLoadingArgs): boolean =>
  event === 'SIGNED_IN' && !hasUser;
