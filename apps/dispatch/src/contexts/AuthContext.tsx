import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { UserDocument } from '../domain/entities';
import {
  createUserWithEmail,
  getUserRoleClaim,
  isStaleSupabaseSessionError,
  SESSION_EXPIRED_ERROR_MESSAGE,
  signInWithEmail,
  signOutUser,
  formatAuthError,
  sendPasswordReset,
  sendVerificationEmail,
} from '../services/supabase/auth';
import { supabase } from '../services/supabase/config';
import { appEnv } from '../config/env';
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
const getActionCodeSettings = (path: string) => ({
  url: `https://${appEnv.appDomain}${path.startsWith('/') ? path : `/${path}`}`,
});

const isProfileOfflineError = (error: unknown) => {
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

const getDispatchAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (isProfileOfflineError(error)) {
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

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearLocalUserState = useCallback(async () => {
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile()]);
  }, []);

  const clearExpiredSession = useCallback(async () => {
    await clearLocalUserState();
    await signOutUser(supabase).catch(() => undefined);
    setUser(null);
    setError(SESSION_EXPIRED_ERROR_MESSAGE);
  }, [clearLocalUserState]);

  const startSingleDeviceSession = useCallback(async (userId: string) => {
    const sessionId = createSessionId();

    await updateUserDocument(userId, {
      activeSessionId: sessionId,
      activeSessionUpdatedAt: new Date().toISOString(),
    });
    await storeSessionId(sessionId);
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
      if (!isProfileOfflineError(releaseError)) {
        console.warn('Unable to release dispatch session in Supabase:', releaseError);
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

  const buildNextUser = useCallback(
    async (authUser: SupabaseAuthUser) => {
      const claimRole = await getUserRoleClaim(authUser);
      let userDocument = await getUserDocument(authUser.id);

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

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (active && !session) {
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      // Background reconciliation must not re-block the UI once the first paint
      // has resolved. Only an explicit sign-in returns to the full-screen spinner.
      if (event === 'SIGNED_IN') {
        setLoading(true);
      }

      try {
        const authUser = session?.user ?? null;

        if (!authUser) {
          setUser(null);
          await clearLocalUserState();
          return;
        }

        const nextUser = await buildNextUser(authUser);

        if (!nextUser) {
          return;
        }

        const sessionIsValid = await syncSingleDeviceSession(nextUser);

        if (!sessionIsValid) {
          return;
        }

        setUser(nextUser);
        await storeUserProfile(nextUser);
      } catch (nextError) {
        const authUser = session?.user ?? null;
        if (isStaleSupabaseSessionError(nextError)) {
          await clearExpiredSession();
          return;
        }

        if (authUser && isProfileOfflineError(nextError)) {
          const cachedUser = await getStoredUserProfile<UserDocument>();

          if (
            cachedUser?.uid === authUser.id &&
            (cachedUser.role === 'dispatch' || cachedUser.role === 'customer')
          ) {
            const fallbackUser: UserDocument = {
              ...cachedUser,
              uid: authUser.id,
              email: authUser.email ?? cachedUser.email,
              emailVerified: Boolean(authUser.email_confirmed_at),
              role: cachedUser.role,
            };

            const sessionIsValid = await syncSingleDeviceSession(fallbackUser);

            if (sessionIsValid) {
              setUser(fallbackUser);
              setError(NO_INTERNET_ERROR);
              return;
            }
          }
        }

        const nextMessage = getDispatchAuthErrorMessage(nextError, 'Failed to load dispatch account');
        console.error('Error syncing dispatch auth state:', nextError);
        setUser(null);
        setError(nextMessage);
        await clearStoredUserProfile();
      } finally {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [buildNextUser, clearLocalUserState, syncSingleDeviceSession]);

  const signUp = async (email: string, password: string, userData: DispatchSignUpInput): Promise<SignUpResult> => {
    setLoading(true);
    setError(null);

    try {
      const { user: authUser, session } = await createUserWithEmail(supabase, email, password, {
        display_name: userData.displayName.trim(),
        phone: userData.phoneNumber.trim(),
        role: 'customer',
      });

      if (!session) {
        let verificationEmailSent = false;

        try {
          await sendVerificationEmail(
            supabase,
            authUser.email ?? email,
            getActionCodeSettings(appEnv.verifyEmailPath)
          );
          verificationEmailSent = true;
        } catch (verificationError) {
          console.warn('Dispatch login created, but verification email could not be sent:', verificationError);
        }

        setError('Verify your email, then sign in to finish setting up your rider account.');
        return { verificationEmailSent, sessionPresent: false };
      }

      return { verificationEmailSent: false, sessionPresent: true };
    } catch (nextError: any) {
      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to sign up');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const authUser = await signInWithEmail(supabase, email, password);
      const nextUser = await buildNextUser(authUser);

      await startSingleDeviceSession(authUser.id);
      setUser(nextUser);
      await storeUserProfile(nextUser);
    } catch (nextError: any) {
      if (isStaleSupabaseSessionError(nextError)) {
        await clearExpiredSession();
        throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
      }

      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to sign in');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    setLoading(true);
    setError(null);

    try {
      await sendPasswordReset(supabase, email, getActionCodeSettings(appEnv.resetPasswordPath));
    } catch (nextError: any) {
      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to send password reset email');
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
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      await releaseSingleDeviceSession(authUser?.id);
      await signOutUser(supabase);
      await clearLocalUserState();
      setUser(null);
    } catch (nextError: any) {
      const nextMessage = getDispatchAuthErrorMessage(nextError, 'Unable to sign out');
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
