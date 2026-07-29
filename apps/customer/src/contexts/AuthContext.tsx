import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from '@supabase/supabase-js';
import { router } from 'expo-router';
import type { UserDocument } from '../domain/entities';
import { DEFAULT_APP_ROLE } from '../domain/roles';
import { appEnv } from '../config/env';
import {
  sendVerificationEmailWithFallback,
  sendPasswordResetEmailWithFallback,
  formatAuthError,
  createUserWithEmail,
  isNetworkRequestError,
  getUserRoleClaim,
  isStaleSupabaseSessionError,
  SESSION_EXPIRED_ERROR_MESSAGE,
  signInWithEmail,
  signOutUser,
  signInWithGoogle,
} from '../services/supabase/auth';
import {
  clearStoredUserProfile,
  clearStoredSessionId,
  clearStoredPolicyAccepted,
  createSessionId,
  getStoredUserProfile,
  getStoredPolicyAccepted,
  getStoredSessionId,
  storePolicyAccepted,
  storeSessionId,
  storeUserProfile,
} from '../services/session';
import { getUserDocument, createUserDocument, updateUserDocument } from '../services/supabase/profile';
import { supabase } from '../services/supabase/config';
import { shouldHydrateCachedUserProfile } from '../../../../packages/auth/src';
import { deleteOwnAccount as deleteOwnCustomerAccount } from '../services/accountManagement';
import {
  getCustomerPolicyAcceptance,
  recordCustomerPolicyAcceptance,
} from '../services/policyAcceptance';
import {
  clearAnalyticsUser,
  identifyAnalyticsUser,
  trackAnalyticsEvent,
} from '../../../../packages/observability/src/analytics';
import type { PolicyAcceptancePayload } from '../../../../packages/domain/src';

export type User = UserDocument | null;

type SignUpResult = {
  verificationEmailSent: boolean;
};

interface AuthContextType {
  user: User;
  loading: boolean;
  policyAccepted: boolean;
  policyLoading: boolean;
  error: string | null;
  signUp: (
    email: string,
    password: string,
    userData?: {
      displayName?: string;
      phoneNumber: string;
      policyAcceptance?: PolicyAcceptancePayload;
    }
  ) => Promise<SignUpResult>;
  acceptCurrentPolicies: (source?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  updatePhoneNumber: (phoneNumber: string) => Promise<void>;
  reloadUser: () => Promise<boolean>;
  sendVerificationEmail: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const CUSTOMER_ACCESS_ERROR = 'This account does not have customer access.';
const SESSION_CONFLICT_ERROR = 'This account was signed in on another device. Sign in again here if you want to continue on this device.';
const isOfflineError = (error: unknown) => {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String((error as any).code) : '';
  const errorMessage =
    typeof error === 'object' && error !== null && 'message' in error ? String((error as any).message).toLowerCase() : '';

  return (
    errorCode === 'unavailable' ||
    errorCode === 'failed-precondition' ||
    errorMessage.includes('client is offline') ||
    errorMessage.includes('offline')
  );
};

const isTransientNetworkError = (error: unknown) => isOfflineError(error) || isNetworkRequestError(error);

const getCustomerAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (isTransientNetworkError(error)) {
    return NO_INTERNET_ERROR;
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    return formatAuthError(error);
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as any).message ?? fallbackMessage);
  }

  return fallbackMessage;
};

/**
 * Get the app domain from environment variables for action code settings
 */
const getActionCodeSettings = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return {
    url: `https://${appEnv.appDomain}${normalizedPath}`,
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearLocalUserState = useCallback(async () => {
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile(), clearStoredPolicyAccepted()]);
  }, []);

  const clearExpiredSession = useCallback(async () => {
    await clearLocalUserState();
    await signOutUser(supabase).catch(() => undefined);
    setUser(null);
    setPolicyAccepted(false);
    setError(SESSION_EXPIRED_ERROR_MESSAGE);
    clearAnalyticsUser();
  }, [clearLocalUserState]);

  const buildNextUser = useCallback(
    async (authUser: SupabaseAuthUser) => {
      let userData = await getUserDocument(authUser.id);

      if (!userData) {
        userData = await createUserDocument(authUser.id, {
          email: authUser.email ?? '',
          emailVerified: Boolean(authUser.email_confirmed_at),
          role: DEFAULT_APP_ROLE,
          displayName:
            (authUser.user_metadata?.display_name as string | undefined) ??
            (authUser.user_metadata?.full_name as string | undefined) ??
            undefined,
          photoURL: (authUser.user_metadata?.avatar_url as string | undefined) ?? undefined,
        });
      }

      const claimRole = await getUserRoleClaim(authUser);

      if (claimRole && claimRole !== DEFAULT_APP_ROLE) {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(CUSTOMER_ACCESS_ERROR);
        return null;
      }

      identifyAnalyticsUser(authUser.id);

      return {
        ...userData,
        uid: authUser.id,
        email: authUser.email ?? userData.email ?? '',
        emailVerified: Boolean(authUser.email_confirmed_at),
        role: DEFAULT_APP_ROLE,
      } satisfies UserDocument;
    },
    [clearLocalUserState]
  );

  const startSingleDeviceSession = useCallback(async (userId: string) => {
    const sessionId = createSessionId();

    await updateUserDocument(userId, {
      activeSessionId: sessionId,
      activeSessionUpdatedAt: new Date().toISOString(),
    });
    await storeSessionId(sessionId);
  }, []);

  const refreshPolicyAcceptance = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    // Silent refresh is used during the background reconcile after a cached
    // first paint: it must not toggle `policyLoading`, which would re-block the
    // UI on the loading spinner we just cleared.
    if (!silent) {
      setPolicyLoading(true);
    }

    try {
      const status = await getCustomerPolicyAcceptance();
      setPolicyAccepted(status.accepted);
      void storePolicyAccepted(status.accepted);
      return status.accepted;
    } catch (policyError) {
      console.warn('Unable to load customer policy acceptance:', policyError);
      const cachedPolicyAccepted = await getStoredPolicyAccepted().catch(() => false);

      // Preserve the locally accepted state when the refresh itself is
      // unavailable. That keeps a freshly signed-up user from being forced
      // back through the policy gate because a network call failed.
      if (!silent) {
        setPolicyAccepted(cachedPolicyAccepted);
      }

      return cachedPolicyAccepted;
    } finally {
      if (!silent) {
        setPolicyLoading(false);
      }
    }
  }, []);

  const flushPendingCustomerPolicyAcceptance = useCallback(async () => {
    const pendingPolicyAccepted = await getStoredPolicyAccepted();

    if (!pendingPolicyAccepted) {
      return;
    }

    try {
      await recordCustomerPolicyAcceptance('customer_signup');
    } catch (policyError) {
      console.warn('Unable to flush pending customer policy acceptance:', policyError);
    }
  }, []);

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
      if (!isOfflineError(releaseError)) {
        console.warn('Unable to release customer session:', releaseError);
      }
    } finally {
      await clearStoredSessionId();
    }
  }, []);

  const syncSingleDeviceSession = useCallback(async (userDocument: UserDocument) => {
    const localSessionId = await getStoredSessionId();
    const remoteSessionId = userDocument.activeSessionId ?? null;

    if (localSessionId && remoteSessionId && localSessionId !== remoteSessionId) {
      await clearLocalUserState();
      await signOutUser(supabase);
      setUser(null);
      setError(SESSION_CONFLICT_ERROR);
      return false;
    }

    if (!localSessionId && remoteSessionId) {
      await storeSessionId(remoteSessionId);
    }

    return true;
  }, [clearLocalUserState]);

  // First paint must not wait on the sequential auth RPCs (getUserDocument,
  // role claim, single-device sync, policy acceptance) that follow
  // onAuthStateChange. Resolve the first frame from local storage only: paint
  // the cached customer profile and cached policy flag if present, or show the
  // login screen immediately when there is no session. onAuthStateChange then
  // reconciles the real state in the background.
  useEffect(() => {
    let active = true;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (!session) {
        setLoading(false);
        return;
      }

      const [cachedUser, cachedPolicyAccepted] = await Promise.all([
        getStoredUserProfile<UserDocument>(),
        getStoredPolicyAccepted(),
      ]);

      if (!active) {
        return;
      }

      if (
        shouldHydrateCachedUserProfile({
          sessionUserId: session.user.id,
          cachedUser,
          expectedRole: DEFAULT_APP_ROLE,
        })
      ) {
        setUser(cachedUser);
        setPolicyAccepted(cachedPolicyAccepted);
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  /**
   * Listen for authentication state changes and sync user profile
   */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      // Background reconciliation (INITIAL_SESSION, TOKEN_REFRESHED, …) must not
      // re-block the UI once the first paint has resolved. Only an explicit
      // sign-in returns to the full-screen spinner.
      const isInteractiveSignIn = event === 'SIGNED_IN';

      if (isInteractiveSignIn) {
        setLoading(true);
      }
      try {
        const authUser = session?.user ?? null;

        if (authUser) {
          const nextUser = await buildNextUser(authUser);
          if (!nextUser) {
            return;
          }
          const sessionIsValid = await syncSingleDeviceSession(nextUser);
          if (!sessionIsValid) {
            return;
          }

          await flushPendingCustomerPolicyAcceptance();
          await refreshPolicyAcceptance({ silent: !isInteractiveSignIn });
          setUser(nextUser);
          await storeUserProfile(nextUser);
        } else {
          setUser(null);
          setPolicyAccepted(false);
          await clearLocalUserState();
        }
      } catch (err) {
        const authUser = session?.user ?? null;
        if (isStaleSupabaseSessionError(err)) {
          await clearExpiredSession();
          return;
        }

        if (authUser && isOfflineError(err)) {
          const cachedUser = await getStoredUserProfile<UserDocument>();

          if (cachedUser?.uid === authUser.id) {
            const fallbackUser: UserDocument = {
              ...cachedUser,
              uid: authUser.id,
              email: authUser.email ?? cachedUser?.email ?? '',
              emailVerified: Boolean(authUser.email_confirmed_at),
              role: cachedUser?.role ?? DEFAULT_APP_ROLE,
            };

            const sessionIsValid = await syncSingleDeviceSession(fallbackUser);

            if (sessionIsValid) {
              setUser(fallbackUser);
              setError(NO_INTERNET_ERROR);
              return;
            }
          }
        }

        if (authUser) {
          const fallbackCachedUser = await getStoredUserProfile<UserDocument>();
          const fallbackUser: UserDocument = {
            uid: authUser.id,
            email: authUser.email ?? fallbackCachedUser?.email ?? '',
            emailVerified: Boolean(authUser.email_confirmed_at),
            role: fallbackCachedUser?.role ?? DEFAULT_APP_ROLE,
            displayName:
              fallbackCachedUser?.displayName ??
              (authUser.user_metadata?.full_name as string | undefined) ??
              undefined,
            photoURL:
              fallbackCachedUser?.photoURL ?? (authUser.user_metadata?.avatar_url as string | undefined) ?? undefined,
            phoneNumber: fallbackCachedUser?.phoneNumber ?? undefined,
            createdAt: fallbackCachedUser?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          setUser(fallbackUser);
          setError(getCustomerAuthErrorMessage(err, 'Failed to load user data'));
          await storeUserProfile(fallbackUser).catch(() => undefined);
          setLoading(false);
          return;
        }

        console.error('Error syncing user authentication state:', err);
        setError(getCustomerAuthErrorMessage(err, 'Failed to load user data'));
        setUser(null);
        await clearStoredUserProfile();
      } finally {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [
    buildNextUser,
    clearExpiredSession,
    clearLocalUserState,
    flushPendingCustomerPolicyAcceptance,
    refreshPolicyAcceptance,
    syncSingleDeviceSession,
  ]);

  const signUp = async (
    email: string,
    password: string,
    userData?: {
      displayName?: string;
      phoneNumber: string;
      policyAcceptance?: PolicyAcceptancePayload;
    }
  ): Promise<SignUpResult> => {
    setLoading(true);
    setError(null);

    try {
      if (userData?.policyAcceptance?.accepted !== true) {
        throw new Error('Accept the Terms and Privacy Policy before creating an account.');
      }

      const { user: authUser } = await createUserWithEmail(supabase, email, password, {
        display_name: userData?.displayName,
        phone: userData?.phoneNumber,
        role: DEFAULT_APP_ROLE,
      });
      const policyAcceptance = userData.policyAcceptance;
      setPolicyAccepted(true);
      void storePolicyAccepted(true);

      try {
        await sendVerificationEmailWithFallback(
          supabase,
          authUser.email ?? email,
          getActionCodeSettings(appEnv.verifyEmailPath)
        );
        trackAnalyticsEvent('customer_sign_up_completed', {
          auth_method: 'email',
          policy_source: policyAcceptance.source || 'customer_signup',
          verification_email_sent: true,
        });
        return { verificationEmailSent: true };
      } catch (verificationError) {
        console.warn('Account created, but verification email could not be sent:', verificationError);
        trackAnalyticsEvent('customer_sign_up_completed', {
          auth_method: 'email',
          policy_source: policyAcceptance.source || 'customer_signup',
          verification_email_sent: false,
        });
        return { verificationEmailSent: false };
      }
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to create account');
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const authUser = await signInWithEmail(supabase, email, password);
      const claimRole = await getUserRoleClaim(authUser);
      if (claimRole && claimRole !== DEFAULT_APP_ROLE) {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(CUSTOMER_ACCESS_ERROR);
        throw new Error(CUSTOMER_ACCESS_ERROR);
      }
      const nextUser = await buildNextUser(authUser);
      if (!nextUser) {
        throw new Error(CUSTOMER_ACCESS_ERROR);
      }

      await flushPendingCustomerPolicyAcceptance();

      // Explicit sign-in deliberately claims this device as the active session.
      // Takeover detection lives in the passive onAuthStateChange path; re-checking
      // here against the pre-claim snapshot would always false-positive on re-login.
      await startSingleDeviceSession(authUser.id);

      identifyAnalyticsUser(authUser.id);
      trackAnalyticsEvent('customer_sign_in_completed', {
        auth_method: 'email',
      });
      setUser(nextUser);
      await storeUserProfile(nextUser);
      await refreshPolicyAcceptance();
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to sign in');
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogleAuth = async (idToken: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const authUser = await signInWithGoogle(supabase, idToken);
      const claimRole = await getUserRoleClaim(authUser);
      if (claimRole && claimRole !== DEFAULT_APP_ROLE) {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(CUSTOMER_ACCESS_ERROR);
        throw new Error(CUSTOMER_ACCESS_ERROR);
      }

      const nextUser = await buildNextUser(authUser);
      if (!nextUser) {
        throw new Error(CUSTOMER_ACCESS_ERROR);
      }

      const userData = await getUserDocument(authUser.id);
      if (userData) {
        await updateUserDocument(authUser.id, {
          displayName: (authUser.user_metadata?.full_name as string | undefined) ?? undefined,
          photoURL: (authUser.user_metadata?.avatar_url as string | undefined) ?? undefined,
        });
      }

      // Explicit sign-in deliberately claims this device as the active session.
      // Takeover detection lives in the passive onAuthStateChange path; re-checking
      // here against the pre-claim snapshot would always false-positive on re-login.
      await startSingleDeviceSession(authUser.id);

      identifyAnalyticsUser(authUser.id);
      trackAnalyticsEvent('customer_sign_in_completed', {
        auth_method: 'google',
      });
      setUser(nextUser);
      await storeUserProfile(nextUser);
      await flushPendingCustomerPolicyAcceptance();
      await refreshPolicyAcceptance();
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to complete Google sign-in');
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      await releaseSingleDeviceSession(authUser?.id);
      await signOutUser(supabase);
      await clearLocalUserState();
      setUser(null);
      setPolicyAccepted(false);
      trackAnalyticsEvent('customer_sign_out_completed');
      clearAnalyticsUser();
      router.replace('/login');
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to sign out');
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async (): Promise<void> => {
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
      await deleteOwnCustomerAccount();
      await signOutUser(supabase).catch(() => undefined);
      await clearLocalUserState();
      setUser(null);
      trackAnalyticsEvent('customer_account_deleted');
      clearAnalyticsUser();
      router.replace('/login');
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to delete this account');
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setLoading(false);
    }
  };

  const updateDisplayName = async (displayName: string): Promise<void> => {
    if (!user?.uid) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    const nextDisplayName = displayName.trim();

    if (!nextDisplayName) {
      const message = 'Username is required';
      setError(message);
      throw new Error(message);
    }

    setLoading(true);
    setError(null);

    try {
      await updateUserDocument(user.uid, {
        displayName: nextDisplayName,
      });

      setUser((currentUser) => {
        if (!currentUser) {
          return currentUser;
        }

        const nextUser = {
          ...currentUser,
          displayName: nextDisplayName,
          updatedAt: new Date().toISOString(),
        };

        void storeUserProfile(nextUser);
        return nextUser;
      });
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to update username');
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setLoading(false);
    }
  };

  const updatePhoneNumber = async (phoneNumber: string): Promise<void> => {
    if (!user?.uid) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    const nextPhoneNumber = phoneNumber.trim();

    if (!nextPhoneNumber) {
      const message = 'Phone number is required';
      setError(message);
      throw new Error(message);
    }

    setLoading(true);
    setError(null);

    try {
      await updateUserDocument(user.uid, {
        phoneNumber: nextPhoneNumber,
      });

      setUser((currentUser) => {
        if (!currentUser) {
          return currentUser;
        }

        const nextUser = {
          ...currentUser,
          phoneNumber: nextPhoneNumber,
          updatedAt: new Date().toISOString(),
        };

        void storeUserProfile(nextUser);
        return nextUser;
      });
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to update phone number');
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setLoading(false);
    }
  };

  const acceptCurrentPolicies = async (source = 'customer_policy_gate'): Promise<void> => {
    setPolicyLoading(true);
    setError(null);

    try {
      await recordCustomerPolicyAcceptance(source);
      setPolicyAccepted(true);
      void storePolicyAccepted(true);
      trackAnalyticsEvent('customer_policy_accepted', {
        source,
      });
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to save policy acceptance');
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setPolicyLoading(false);
    }
  };

  const resetPassword = async (email: string): Promise<void> => {
    setError(null);

    try {
      await sendPasswordResetEmailWithFallback(
        supabase,
        email,
        getActionCodeSettings(appEnv.resetPasswordPath)
      );
      trackAnalyticsEvent('customer_password_reset_requested', {
        email_domain: email.includes('@') ? email.split('@').pop() ?? null : null,
      });
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to send reset email');
      setError(formattedError);
      throw new Error(formattedError);
    }
  };

  const reloadUser = async (): Promise<boolean> => {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    try {
      await supabase.auth.refreshSession();
      const {
        data: { user: refreshedUser },
      } = await supabase.auth.getUser();
      const emailVerified = Boolean(refreshedUser?.email_confirmed_at);

      setUser((currentUser) =>
        currentUser
          ? {
              ...currentUser,
              emailVerified,
            }
          : currentUser
      );

      // Update database if email is now verified
      if (emailVerified) {
        await updateUserDocument(authUser.id, {
          emailVerified: true,
        }).catch((err) => console.error('Error updating email verification status:', err));
        trackAnalyticsEvent('customer_email_verified');
      }

      return emailVerified;
    } catch (err) {
      if (isStaleSupabaseSessionError(err)) {
        await clearExpiredSession();
        throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
      }

      console.error('Error reloading user:', err);
      setError(getCustomerAuthErrorMessage(err, 'Failed to reload user data'));
      throw err;
    }
  };

  const sendVerificationEmail = async (): Promise<void> => {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser?.email) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    try {
      await sendVerificationEmailWithFallback(
        supabase,
        authUser.email,
        getActionCodeSettings(appEnv.verifyEmailPath)
      );
      trackAnalyticsEvent('customer_verification_email_requested');
    } catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to send verification email');
      setError(formattedError);
      throw new Error(formattedError);
    }
  };

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        policyAccepted,
        policyLoading,
        error,
        signUp,
        acceptCurrentPolicies,
        signIn,
        signInWithGoogle: signInWithGoogleAuth,
        signOut,
        resetPassword,
        deleteAccount,
        updateDisplayName,
        updatePhoneNumber,
        reloadUser,
        sendVerificationEmail,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
