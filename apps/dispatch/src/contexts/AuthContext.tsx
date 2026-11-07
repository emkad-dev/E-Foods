import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { UserDocument } from '../domain/entities';
import {
  ACCOUNT_ALREADY_REGISTERED_MESSAGE,
  createUserWithEmail,
  getUserRoleClaim,
  isStaleSupabaseSessionError,
  SESSION_EXPIRED_ERROR_MESSAGE,
  signInWithEmail,
  signOutUser,
  formatAuthError,
  sendPasswordReset,
} from '../services/supabase/auth';
import { supabase } from '../services/supabase/config';
import { deleteOwnAccount as deleteOwnDispatchAccount } from '../services/accountManagement';
import {
  clearStoredUserProfile,
  clearStoredSessionId,
  createSessionId,
  getStoredUserProfile,
  getStoredSessionId,
  storeSessionId,
  storeUserProfile,
} from '../services/session';
import { createUserDocument, getUserDocument, updateUserDocument } from '../services/supabase/profile';
import { fetchDispatchBootstrap } from '../services/dispatchBootstrap';
import {
  RELEASE_SESSION_TIMEOUT_MS,
  bestEffortWithin,
  createDeviceClaims,
  createForegroundSessionCheck,
  isReconcileStillValid,
  isTransientNetworkFailure,
  resolveNullSessionOutcome,
  resolveProfileLoadFailure,
  resolveSingleDeviceSessionDecision,
  shouldShowSignInLoading,
  type SignInAttempt,
} from '../../../../packages/auth/src';
import { reportError } from '../../../../packages/observability/src/sentry';
import { toUserMessage } from '../../../../packages/observability/src/userMessage';
import { MISSING_PROFILE_ERROR, resolveDispatchAccessState } from './dispatchAuthFlow';

type DispatchSignUpInput = {
  displayName: string;
  phoneNumber: string;
};

type SignUpResult = {
  verificationEmailSent: boolean;
  sessionPresent: boolean;
};

type AuthContextType = {
  user: UserDocument | null;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string, userData: DispatchSignUpInput) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const SESSION_CONFLICT_ERROR =
  'This account was signed in on another device. Sign in again here if you want to continue on this device.';
const getDispatchAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (isTransientNetworkFailure(error)) {
    return NO_INTERNET_ERROR;
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    return formatAuthError(error);
  }

  // Anything else (including a plain `message`) goes through `toUserMessage`
  // rather than being shown verbatim -- it may be a raw Supabase/Postgres
  // string, not friendly copy.
  return toUserMessage(error, fallbackMessage);
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether a rider is already signed in, without re-subscribing the
  // auth listener. Used to avoid re-showing the full-screen spinner when the
  // browser re-fires SIGNED_IN on tab/app refocus.
  const hasUserRef = useRef(false);

  // The same for the error, so the foreground check below reads the current one.
  const errorRef = useRef<string | null>(null);

  useEffect(() => {
    hasUserRef.current = Boolean(user);
  }, [user]);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  // The interactive sign-in's device claim and its guard (packages/auth
  // deviceClaim.ts). The passive onAuthStateChange reconcile steps aside while
  // the guard is held so signIn's single-device claim is not raced into a
  // self-eviction on the next refresh. The guard outlasts signIn() itself, until
  // the background claim settles.
  const deviceClaims = useMemo(
    () =>
      createDeviceClaims({
        createSessionId,
        writeRemote: (userId, sessionId) =>
          updateUserDocument(userId, {
            activeSessionId: sessionId,
            activeSessionUpdatedAt: new Date().toISOString(),
          }),
        storeLocal: storeSessionId,
        report: (claimError) => reportError('dispatch.auth.claim_device_session', claimError),
      }),
    []
  );

  const clearLocalUserState = useCallback(async () => {
    // Every caller is ending this session (sign-out, eviction, expiry, a refused
    // role). A claim still in flight belongs to that session and must not write a
    // device id afterwards; see deviceClaim.ts.
    deviceClaims.invalidate();
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile()]);
  }, [deviceClaims]);

  const clearExpiredSession = useCallback(async () => {
    await clearLocalUserState();
    await signOutUser(supabase).catch(() => undefined);
    setUser(null);
    setError(SESSION_EXPIRED_ERROR_MESSAGE);
  }, [clearLocalUserState]);

  const releaseSingleDeviceSession = useCallback(async (userId?: string | null) => {
    const localSessionId = await getStoredSessionId();

    try {
      if (userId && localSessionId) {
        const userDocument = await getUserDocument(userId);

        if (userDocument?.activeSessionId === localSessionId) {
          await updateUserDocument(userId, {
            activeSessionId: null,
            activeSessionUpdatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (releaseError) {
      if (!isTransientNetworkFailure(releaseError)) {
        console.warn('Unable to release dispatch session in Supabase:', releaseError);
      }
    }
  }, []);

  const syncSingleDeviceSession = useCallback(async (userDocument: UserDocument) => {
    const localSessionId = await getStoredSessionId();
    const remoteSessionId = userDocument.activeSessionId ?? null;

    // Dispatch keeps the single-device lock (enforceSingleDevice: true), using
    // the shared tested decision so "missing remote", "first sight", "same
    // device" and "real takeover" are handled identically to customer.
    const decision = resolveSingleDeviceSessionDecision({
      localSessionId,
      remoteSessionId,
      enforceSingleDevice: true,
    });

    if (decision.type === 'evict') {
      await clearLocalUserState();
      await signOutUser(supabase);
      setUser(null);
      setError(SESSION_CONFLICT_ERROR);
      return false;
    }

    if (decision.type === 'adopt') {
      await storeSessionId(decision.sessionId);
    }

    return true;
  }, [clearLocalUserState]);

  const buildNextUser = useCallback(
    // `prefetchedProfile` is the profile an interactive sign-in already fetched
    // through dispatchBootstrap; without it (or when it was empty) the profile is
    // read here exactly as before.
    async (authUser: SupabaseAuthUser, prefetchedProfile?: UserDocument | null) => {
      const claimRole = await getUserRoleClaim(authUser);
      let userDocument = prefetchedProfile ?? (await getUserDocument(authUser.id));

      if (!userDocument && claimRole !== 'dispatch') {
        userDocument = await createUserDocument(authUser.id, {
          displayName:
            (authUser.user_metadata?.display_name as string | undefined) ??
            (authUser.user_metadata?.full_name as string | undefined) ??
            undefined,
          email: authUser.email ?? '',
          emailVerified: Boolean(authUser.email_confirmed_at),
          phoneNumber: (authUser.user_metadata?.phone as string | undefined) ?? undefined,
          role: 'customer',
        });
      }

      if (!userDocument) {
        // A reconcile that outlived a sign-out read this with no session behind it,
        // so it is no verdict, and the sign-out below could hit a newer session.
        // The reconcile's catch discards the throw.
        if (!(await isReconcileStillValid(supabase, { user: authUser }))) {
          throw new Error(MISSING_PROFILE_ERROR);
        }

        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(MISSING_PROFILE_ERROR);
        throw new Error(MISSING_PROFILE_ERROR);
      }

      const accessState = resolveDispatchAccessState({
        claimRole: claimRole === 'dispatch' || claimRole === 'customer' ? claimRole : null,
        userDocument: {
          dispatchApplicationRejectionReason: userDocument.dispatchApplicationRejectionReason ?? null,
          dispatchApplicationStatus:
            userDocument.dispatchApplicationStatus === 'pending' ||
            userDocument.dispatchApplicationStatus === 'approved' ||
            userDocument.dispatchApplicationStatus === 'rejected'
              ? userDocument.dispatchApplicationStatus
              : null,
        },
      });

      if (accessState.kind === 'blocked') {
        // As above: not a verdict if this reconcile outlived a sign-out.
        if (!(await isReconcileStillValid(supabase, { user: authUser }))) {
          throw new Error(accessState.message);
        }

        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(accessState.message);
        throw new Error(accessState.message);
      }

      return {
        ...userDocument,
        uid: authUser.id,
        email: authUser.email ?? userDocument.email,
        emailVerified: Boolean(authUser.email_confirmed_at),
        role: accessState.userRole,
      } satisfies UserDocument;
    },
    [clearLocalUserState]
  );

  // First paint must not wait on the sequential auth RPCs (role claim,
  // getUserDocument, single-device sync) that follow onAuthStateChange. Resolve
  // the first frame from local storage only: paint the cached rider profile if
  // present, or show the login screen immediately when there is no session. The
  // onAuthStateChange listener reconciles the real state in the background.
  useEffect(() => {
    let active = true;
    // Belt-and-suspenders: if getSession() hangs on a poor cellular connection
    // (no error thrown, just never resolves), release the skeleton after 10 s.
    const fallbackTimer = setTimeout(() => {
      if (active) setLoading(false);
    }, 10_000);

    void (async () => {
      const cachedUser = await getStoredUserProfile<UserDocument>();

      if (!active) {
        return;
      }

      if (cachedUser && (cachedUser.role === 'dispatch' || cachedUser.role === 'customer')) {
        setUser(cachedUser);
        setLoading(false);
        return;
      }

      // No saved profile: release the skeleton now. getSession() would refresh
      // an expired token first, and offline that retries for ~25 s -- a rider
      // with no saved state just needs the login screen (or the listener's
      // reconcile) rather than a spinner.
      setLoading(false);
    })();

    return () => {
      active = false;
      clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    // Supabase awaits this listener while holding its auth lock (including the
    // SIGNED_IN it re-fires whenever a browser tab regains focus), and every
    // RPC below reads the session through that same lock. Awaiting them inside
    // the listener deadlocked the client: every later auth call queued behind
    // it forever, so actions spun with no request ever sent. The listener only
    // schedules the work; the queue keeps events in order, as the lock did.
    let disposed = false;
    let reconcileQueue: Promise<void> = Promise.resolve();
    const reconcileAuthState = async (event: AuthChangeEvent, session: Session | null) => {
      // No SIGNED_OUT follows a sign-out, so this can outlive it: a read returning
      // afterwards must not put the rider back on screen. Stale means no state
      // change at all. The check that remains in `finally` only undoes this
      // reconcile's own spinner.
      let isStale = false;
      const reconcileIsStale = async () => {
        isStale = !(await isReconcileStillValid(supabase, session));
        return isStale;
      };

      if (await reconcileIsStale()) {
        return;
      }

      // An interactive signIn() owns the SIGNED_IN it triggers (it builds the
      // user, claims the single-device session and drives the spinner). Running
      // this reconcile at the same time would race that claim and self-evict on
      // the next refresh, so step aside. Any event carrying a session counts, not
      // just SIGNED_IN: USER_UPDATED or TOKEN_REFRESHED inside the window would
      // otherwise run the reconcile and store the old device id. A sign-out (null
      // session) must still get through.
      if (session && deviceClaims.isGuardHeld()) {
        return;
      }

      // Background reconciliation must not re-block the UI once the first paint
      // has resolved. Only a *fresh* sign-in returns to the full-screen
      // spinner -- on web, refocusing the tab re-fires SIGNED_IN for an
      // already-signed-in rider, and that must reconcile silently in the
      // background instead of flashing the spinner.
      const raisedLoading = shouldShowSignInLoading({ event, hasUser: hasUserRef.current });

      if (raisedLoading) {
        setLoading(true);
      }

      try {
        const authUser = session?.user ?? null;

        if (!authUser) {
          // A null session is only a sign-out when supabase-js says so. Offline
          // with an expired access token it delivers INITIAL_SESSION + null
          // while the stored session is still there; clearing local state then
          // signed the rider out of the UI and wiped their saved profile AND
          // device id (so a device evicted meanwhile re-adopted the other
          // device's id when the network came back).
          const nullSession = await resolveNullSessionOutcome(supabase, event);

          if (nullSession === 'offline') {
            const cachedUser = await getStoredUserProfile<UserDocument>();
            if (
              !hasUserRef.current &&
              (cachedUser?.role === 'dispatch' || cachedUser?.role === 'customer')
            ) {
              setUser(cachedUser);
            }
            setError(NO_INTERNET_ERROR);
            return;
          }

          setUser(null);
          await clearLocalUserState();
          return;
        }

        const nextUser = await buildNextUser(authUser);

        if (await reconcileIsStale()) {
          return;
        }

        if (!nextUser) {
          return;
        }

        const sessionIsValid = await syncSingleDeviceSession(nextUser);

        if (!sessionIsValid || (await reconcileIsStale())) {
          return;
        }

        setUser(nextUser);
        // Reached the server this time: an earlier no-internet notice is stale.
        setError((current) => (current === NO_INTERNET_ERROR ? null : current));
        await storeUserProfile(nextUser);
      } catch (nextError) {
        const authUser = session?.user ?? null;

        // After a sign-out this failure means nothing: the read went out with no
        // session behind it, and every branch below would change state over it.
        if (await reconcileIsStale()) {
          return;
        }

        if (isStaleSupabaseSessionError(nextError)) {
          await clearExpiredSession();
          return;
        }

        const cachedUser = authUser ? await getStoredUserProfile<UserDocument>() : null;

        if (await reconcileIsStale()) {
          return;
        }

        const hasUsableCachedProfile = Boolean(
          authUser &&
            cachedUser?.uid === authUser.id &&
            (cachedUser.role === 'dispatch' || cachedUser.role === 'customer')
        );
        // A network failure while reloading the profile is not a sign-out: the
        // Supabase session is intact. Keep the saved profile on screen, or, with
        // none, say there is no internet WITHOUT clearing anything, so the next
        // reconcile can sign them straight in. On native only the foreground check
        // below starts one soon: auth-js does not notice the network coming back.
        const failureOutcome = resolveProfileLoadFailure({
          error: nextError,
          hasAuthUser: Boolean(authUser),
          hasUsableCachedProfile,
        });

        if (authUser && cachedUser && failureOutcome === 'keep-cached-user') {
          // No single-device check here on purpose. The saved profile's
          // activeSessionId is whatever was read BEFORE this device claimed the
          // session at sign-in, so comparing it with our own stored id reads as
          // a takeover and would evict a rider whose only fault is a bad signal.
          // Takeover detection resumes on the first reconcile that reaches the
          // server.
          setUser({
            ...cachedUser,
            uid: authUser.id,
            email: authUser.email ?? cachedUser.email,
            emailVerified: Boolean(authUser.email_confirmed_at),
            role: cachedUser.role,
          });
          setError(NO_INTERNET_ERROR);
          return;
        }

        if (failureOutcome === 'offline-without-profile') {
          setUser(null);
          setError(NO_INTERNET_ERROR);
          return;
        }

        const nextMessage = getDispatchAuthErrorMessage(nextError, 'Failed to load dispatch account');
        console.error('Error syncing dispatch auth state:', nextError);
        // `buildNextUser`/`syncSingleDeviceSession` read and write user
        // profiles via direct `supabase.from(...)` calls (packages/auth's
        // profileApi.ts), not routed through `callBackendRpc`, so nothing
        // else reports this failure.
        reportError('dispatch.auth_state_sync', nextError);
        setUser(null);
        setError(nextMessage);
        await clearStoredUserProfile();
      } finally {
        if (!isStale || raisedLoading) {
          setLoading(false);
        }
      }
    };

    const queueReconcile = (event: AuthChangeEvent, session: Session | null) => {
      setTimeout(() => {
        reconcileQueue = reconcileQueue
          .then(() => (disposed ? undefined : reconcileAuthState(event, session)))
          .catch((error) => console.error('Auth state reconcile failed:', error));
      }, 0);
    };

    // After a network failure, returning to the foreground retries the reconcile;
    // see foregroundSessionCheck.ts. Labelled TOKEN_REFRESHED because that is the
    // same session being re-checked: a background pass with no spinner.
    const foregroundCheck = createForegroundSessionCheck<Session>({
      initialState: AppState.currentState,
      getSession: () => supabase.auth.getSession(),
      isOffline: () => errorRef.current === NO_INTERNET_ERROR,
      isSignInInProgress: () => deviceClaims.isGuardHeld(),
      queueReconcile: (session) => queueReconcile('TOKEN_REFRESHED', session),
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      foregroundCheck.noteAuthEvent();
      queueReconcile(event, session);
    });
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      void foregroundCheck.onAppStateChange(nextState);
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, [buildNextUser, clearExpiredSession, clearLocalUserState, deviceClaims, syncSingleDeviceSession]);

  const signUp = async (email: string, password: string, userData: DispatchSignUpInput): Promise<SignUpResult> => {
    setLoading(true);
    setError(null);

    try {
      // The sign-up call itself sends the confirmation email. Resending here
      // would only trip Supabase's 60s cooldown. No redirect is passed:
      // confirmation is OTP-only, so the email carries a 6-digit code the rider
      // types on /verify-email and there is no link to steer.
      const { session, alreadyRegistered } = await createUserWithEmail(supabase, email, password, {
        display_name: userData.displayName.trim(),
        phone: userData.phoneNumber.trim(),
        role: 'customer',
      });

      // Supabase answers a repeat sign-up with HTTP 200 and an empty
      // `identities` array instead of an error, so without this branch the
      // screen navigated to the code entry screen and the rider waited for a
      // confirmation email that was never sent. Thrown rather than returned so
      // the existing catch below puts it in `error` — the slot the register
      // screen already renders — leaving `SignUpResult` and this context's
      // public shape untouched.
      if (alreadyRegistered) {
        throw new Error(ACCOUNT_ALREADY_REGISTERED_MESSAGE);
      }

      if (!session) {
        setError('Verify your email, then sign in to finish setting up your rider account.');
        return { verificationEmailSent: true, sessionPresent: false };
      }

      return { verificationEmailSent: false, sessionPresent: true };
    } catch (nextError: any) {
      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to sign up');

      // `createUserWithEmail` is a direct `supabase.auth.signUp` call, not
      // routed through `callBackendRpc`, so nothing else reports this. Skip
      // the expected "already registered" outcome thrown above -- it is not
      // a fault.
      if (!(nextError instanceof Error && nextError.message === ACCOUNT_ALREADY_REGISTERED_MESSAGE)) {
        reportError('dispatch.auth.sign_up', nextError);
      }

      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    // beginSignIn holds the guard (so the passive reconcile skips the SIGNED_IN
    // this triggers and does not race the single-device claim) until the
    // background claim settles. It is released on every exit path:
    // `attempt.release()` below when signIn fails before the claim starts, by the
    // claim otherwise.
    let attempt: SignInAttempt | null = null;
    setLoading(true);
    setError(null);

    try {
      // Supersedes any earlier claim and waits (capped) for one that is mid-write,
      // so the clear below cannot be undone by its local store.
      attempt = await deviceClaims.beginSignIn();
      // Forget any device id left from an earlier sign-in BEFORE claiming a new
      // one. The claim writes remote first, then stores locally; if the app is
      // force-closed between the two, local-old + remote-new reads as a takeover
      // and evicts this very device on the next launch. With local empty that
      // same state is simply adopted. The write order below must not change.
      await clearStoredSessionId();
      const authUser = await signInWithEmail(supabase, email, password);
      // The profile in one call (landing on the warmed feasty-dispatch). Null
      // when the backend does not implement the action yet, in which case
      // buildNextUser reads the profile itself as before.
      const bootstrap = await fetchDispatchBootstrap().catch((bootstrapError) => {
        console.warn('dispatchBootstrap unavailable, falling back to the direct profile read:', bootstrapError);
        return null;
      });
      const nextUser = await buildNextUser(authUser, bootstrap?.profile);

      // Claimed in the background: the rider is in once their profile is ready.
      attempt.startClaim(authUser.id);
      setUser(nextUser);
      await storeUserProfile(nextUser);
    } catch (nextError: any) {
      if (isStaleSupabaseSessionError(nextError)) {
        await clearExpiredSession();
        throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
      }

      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to sign in');
      // `signInWithEmail` and `buildNextUser`'s direct-Supabase reads
      // (getUserDocument/createUserDocument) are not routed through
      // `callBackendRpc`, so nothing else reports these.
      reportError('dispatch.auth.sign_in', nextError);
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      attempt?.release();
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    setLoading(true);
    setError(null);

    try {
      // No redirect: the recovery email carries a 6-digit code redeemed on
      // /reset-password, not a link.
      await sendPasswordReset(supabase, email);
    } catch (nextError: any) {
      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to send password reset email');
      // `sendPasswordReset` is a direct `supabase.auth.resetPasswordForEmail`
      // call, not routed through `callBackendRpc`.
      reportError('dispatch.auth.reset_password', nextError);
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    setError(null);

    try {
      // End any background device claim first: it must not write a device id for
      // a session that is being closed (clearLocalUserState below only runs after
      // the server work).
      deviceClaims.invalidate();
      // The in-memory user, not supabase.auth.getUser(): with an expired token
      // getUser() refreshes first, which offline stalls for ~25 s. The server
      // work is time-boxed and signOutUser always ends this device's session
      // (bounded server attempt, then local removal), so signing out works
      // offline. The device id is cleared below, only once that has happened.
      await bestEffortWithin(() => releaseSingleDeviceSession(user?.uid), RELEASE_SESSION_TIMEOUT_MS);
      await signOutUser(supabase);
      await clearLocalUserState();
      setUser(null);
    } catch (nextError: any) {
      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to sign out');
      // `signOutUser`/`supabase.auth.getUser` are direct Supabase calls, not
      // routed through `callBackendRpc`.
      reportError('dispatch.auth.sign_out', nextError);
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async () => {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    setLoading(true);
    setError(null);

    try {
      await deleteOwnDispatchAccount();
      await signOutUser(supabase).catch(() => undefined);
      await clearLocalUserState();
      setUser(null);
    } catch (nextError: any) {
      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to delete this account');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => {
    setError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        signUp,
        signIn,
        resetPassword,
        signOut,
        deleteAccount,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};
