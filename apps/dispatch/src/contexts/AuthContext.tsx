import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { UserDocument } from '../domain/entities';
import {
  createUserWithEmail,
  getUserRoleClaim,
  signInWithEmail,
  signOutUser,
  formatAuthError,
  sendPasswordReset,
  sendVerificationEmail,
} from '../services/supabase/auth';
import { supabase } from '../services/supabase/config';
import { appEnv } from '../config/env';
import { submitDispatchApplication, type DispatchApplicationInput } from '../services/dispatchApplications';
import { buildDispatchPolicyAcceptance } from '../services/policyAcceptance';
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

type AuthContextType = {
  user: UserDocument | null;
  loading: boolean;
  error: string | null;
  signUp: (
    email: string,
    password: string,
    userData: DispatchApplicationInput
  ) => Promise<{ verificationEmailSent: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DISPATCH_ACCESS_ERROR = 'This account does not have dispatch access.';
const MISSING_PROFILE_ERROR = 'No dispatch profile was found for this account.';
const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const SESSION_CONFLICT_ERROR =
  'This account was signed in on another device. Sign in again here if you want to continue on this device.';
const DISPATCH_APPLICATION_READY_MESSAGE =
  'Your rider account is live. Sign in again after you verify your email.';
const DISPATCH_APPLICATION_PENDING_MESSAGE =
  'Your rider account is being prepared. Sign in again shortly.';
const DISPATCH_APPLICATION_REJECTED_FALLBACK =
  'Your rider account is not active yet. Contact the operations team and update your details before trying again.';
const DISPATCH_SIGNUP_ROLLBACK_ERROR =
  'Your rider application could not be completed and the temporary account could not be fully removed. Try again with a stable connection or contact the operations team.';
const getActionCodeSettings = (path: string) => ({
  url: `${appEnv.appScheme}://${path}`,
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

const getDispatchAccessStateMessage = (userDocument: Partial<UserDocument> | null) => {
  if (!userDocument) {
    return MISSING_PROFILE_ERROR;
  }

  if (userDocument.dispatchApplicationStatus === 'pending') {
    return DISPATCH_APPLICATION_PENDING_MESSAGE;
  }

  if (userDocument.dispatchApplicationStatus === 'rejected') {
    return userDocument.dispatchApplicationRejectionReason ?? DISPATCH_APPLICATION_REJECTED_FALLBACK;
  }

  return DISPATCH_ACCESS_ERROR;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pendingApplicantUidRef = useRef<string | null>(null);

  const clearLocalUserState = useCallback(async () => {
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile()]);
  }, []);

  const rollbackPendingApplicant = useCallback(async () => {
    pendingApplicantUidRef.current = null;

    try {
      await deleteOwnDispatchAccount();
      await signOutUser(supabase).catch(() => undefined);
      await clearLocalUserState();
      setUser(null);
      return true;
    } catch (rollbackError) {
      console.error('Failed to rollback dispatch applicant signup:', rollbackError);
      await clearLocalUserState();
      setUser(null);
      return false;
    }
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
      const userDocument = await getUserDocument(authUser.id);

      if (claimRole !== 'dispatch') {
        if (pendingApplicantUidRef.current === authUser.id) {
          return null;
        }

        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(getDispatchAccessStateMessage(userDocument));
        return null;
      }

      if (!userDocument) {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(MISSING_PROFILE_ERROR);
        return null;
      }

      return {
        ...userDocument,
        uid: authUser.id,
        email: authUser.email ?? userDocument.email,
        emailVerified: Boolean(authUser.email_confirmed_at),
        role: claimRole,
      } satisfies UserDocument;
    },
    [clearLocalUserState]
  );

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event: AuthChangeEvent, session: Session | null) => {
      setLoading(true);

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
        if (authUser && isProfileOfflineError(nextError)) {
          const cachedUser = await getStoredUserProfile<UserDocument>();

          if (cachedUser?.uid === authUser.id && cachedUser.role === 'dispatch') {
            const fallbackUser: UserDocument = {
              ...cachedUser,
              uid: authUser.id,
              email: authUser.email ?? cachedUser.email,
              emailVerified: Boolean(authUser.email_confirmed_at),
              role: 'dispatch',
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

  const signUp = async (email: string, password: string, userData: DispatchApplicationInput) => {
    setLoading(true);
    setError(null);
    let applicantUid: string | null = null;

    try {
      const authUser = await createUserWithEmail(supabase, email, password);
      applicantUid = authUser.id;
      pendingApplicantUidRef.current = authUser.id;

      await createUserDocument(authUser.id, {
        displayName: userData.displayName.trim(),
        email: authUser.email ?? email,
        emailVerified: Boolean(authUser.email_confirmed_at),
        phoneNumber: userData.phoneNumber.trim(),
        role: 'customer',
      });

      await submitDispatchApplication({
        ...userData,
        displayName: userData.displayName.trim(),
        phoneNumber: userData.phoneNumber.trim(),
        policyAcceptance: userData.policyAcceptance ?? buildDispatchPolicyAcceptance('dispatch_signup'),
        region: userData.region.trim(),
        vehicleType: userData.vehicleType.trim(),
      });

      let verificationEmailSent = false;

      try {
        await sendVerificationEmail(
          supabase,
          authUser.email ?? email,
          getActionCodeSettings(appEnv.verifyEmailPath)
        );
        verificationEmailSent = true;
      } catch (verificationError) {
        console.warn('Dispatch account created, but verification email could not be sent:', verificationError);
      }

      await clearLocalUserState();
      await signOutUser(supabase);
      setUser(null);
      setError(DISPATCH_APPLICATION_READY_MESSAGE);
      return { verificationEmailSent };
    } catch (nextError: any) {
      let nextMessage =
        nextError?.message === DISPATCH_APPLICATION_READY_MESSAGE
          ? DISPATCH_APPLICATION_READY_MESSAGE
          : getDispatchAuthErrorMessage(nextError, 'Unable to sign up');

      if (applicantUid) {
        const rollbackSucceeded = await rollbackPendingApplicant();

        if (!rollbackSucceeded) {
          nextMessage = DISPATCH_SIGNUP_ROLLBACK_ERROR;
        }
      }

      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      pendingApplicantUidRef.current = null;
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const authUser = await signInWithEmail(supabase, email, password);
      const claimRole = await getUserRoleClaim(authUser);

      if (claimRole !== 'dispatch') {
        const userDocument = await getUserDocument(authUser.id);
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        const nextMessage = getDispatchAccessStateMessage(userDocument);
        setError(nextMessage);
        throw new Error(nextMessage);
      }

      const userDocument = await getUserDocument(authUser.id);

      if (!userDocument) {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(MISSING_PROFILE_ERROR);
        throw new Error(MISSING_PROFILE_ERROR);
      }

      await startSingleDeviceSession(authUser.id);
    } catch (nextError: any) {
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
