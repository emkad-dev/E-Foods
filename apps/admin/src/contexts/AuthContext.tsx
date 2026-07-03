import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { UserDocument } from '../domain/entities';
import {
  formatAuthError,
  getUserRoleClaim,
  isStaleSupabaseSessionError,
  sendPasswordReset,
  SESSION_EXPIRED_ERROR_MESSAGE,
  signInWithEmail,
  signOutUser,
} from '../services/supabase/auth';
import { supabase } from '../services/supabase/config';
import { callAdminBackendRpc } from '../services/backendRpc';
import { appEnv } from '../config/env';
import {
  clearStoredSessionId,
  clearStoredUserProfile,
  createSessionId,
  getStoredSessionId,
  getStoredUserProfile,
  storeSessionId,
  storeUserProfile,
} from '../services/session';
import { getUserDocument, updateUserDocument } from '../services/supabase/profile';

type AuthContextType = {
  user: UserDocument | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  bootstrapFirstAdmin: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ADMIN_ACCESS_ERROR = 'This account does not have admin access.';
const MISSING_PROFILE_ERROR = 'No admin profile was found for this account.';
const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const SESSION_CONFLICT_ERROR =
  'This admin account was signed in on another device. Sign in again here if you want to continue on this device.';
const BOOTSTRAP_WAIT_MESSAGE = 'Preparing first admin access...';
const getActionCodeSettings = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const webOrigin = appEnv.appDomain.startsWith('http')
    ? appEnv.appDomain
    : `https://${appEnv.appDomain}`;

  return {
    url: new URL(normalizedPath, `${webOrigin.replace(/\/$/, '')}/`).toString(),
  };
};

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

const getAdminAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
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
  const bootstrapInProgressRef = useRef(false);

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
        console.warn('Unable to release admin session in Supabase:', releaseError);
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

      if (claimRole !== 'admin') {
        if (bootstrapInProgressRef.current) {
          setError(BOOTSTRAP_WAIT_MESSAGE);
          return null;
        }

        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(ADMIN_ACCESS_ERROR);
        return null;
      }

      const userDocument = await getUserDocument(authUser.id);

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
        if (isStaleSupabaseSessionError(nextError)) {
          await clearExpiredSession();
          return;
        }

        if (authUser && isProfileOfflineError(nextError)) {
          const cachedUser = await getStoredUserProfile<UserDocument>();

          if (cachedUser?.uid === authUser.id && cachedUser.role === 'admin') {
            const fallbackUser: UserDocument = {
              ...cachedUser,
              uid: authUser.id,
              email: authUser.email ?? cachedUser.email,
              emailVerified: Boolean(authUser.email_confirmed_at),
              role: 'admin',
            };

            const sessionIsValid = await syncSingleDeviceSession(fallbackUser);

            if (sessionIsValid) {
              setUser(fallbackUser);
              setError(NO_INTERNET_ERROR);
              return;
            }
          }
        }

        const nextMessage = getAdminAuthErrorMessage(nextError, 'Failed to load admin account');
        console.error('Error syncing admin auth state:', nextError);
        setUser(null);
        setError(nextMessage);
        await clearStoredUserProfile();
      } finally {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [buildNextUser, clearLocalUserState, syncSingleDeviceSession]);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const authUser = await signInWithEmail(supabase, email, password);
      const claimRole = await getUserRoleClaim(authUser);

      if (claimRole !== 'admin') {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(ADMIN_ACCESS_ERROR);
        throw new Error(ADMIN_ACCESS_ERROR);
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
      if (isStaleSupabaseSessionError(nextError)) {
        await clearExpiredSession();
        throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
      }

      const nextMessage = getAdminAuthErrorMessage(nextError, 'Unable to sign in');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const bootstrapFirstAdmin = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      bootstrapInProgressRef.current = true;
      await signInWithEmail(supabase, email, password);
      await callAdminBackendRpc<{ role: string }>('bootstrapFirstAdmin');
      await supabase.auth.refreshSession();

      const {
        data: { user: refreshedUser },
      } = await supabase.auth.getUser();

      if (!refreshedUser) {
        throw new Error('Bootstrap completed, but the session could not be refreshed.');
      }

      const claimRole = await getUserRoleClaim(refreshedUser);

      if (claimRole !== 'admin') {
        throw new Error('Bootstrap completed, but the admin claim has not refreshed yet. Sign in again in a moment.');
      }

      const userDocument = await getUserDocument(refreshedUser.id);

      if (!userDocument) {
        throw new Error(MISSING_PROFILE_ERROR);
      }

      await startSingleDeviceSession(refreshedUser.id);

      const nextUser: UserDocument = {
        ...userDocument,
        uid: refreshedUser.id,
        email: refreshedUser.email ?? userDocument.email,
        emailVerified: Boolean(refreshedUser.email_confirmed_at),
        role: claimRole,
      };

      setUser(nextUser);
      await storeUserProfile(nextUser);
    } catch (nextError: any) {
      if (isStaleSupabaseSessionError(nextError)) {
        await clearExpiredSession();
        throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
      }

      await signOutUser(supabase).catch(() => undefined);
      const nextMessage = getAdminAuthErrorMessage(nextError, 'Unable to bootstrap the first admin account');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      bootstrapInProgressRef.current = false;
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    setLoading(true);
    setError(null);

    try {
      await sendPasswordReset(supabase, email, getActionCodeSettings(appEnv.resetPasswordPath));
    } catch (nextError: any) {
      const nextMessage = getAdminAuthErrorMessage(nextError, 'Unable to send password reset email');
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
      const nextMessage = getAdminAuthErrorMessage(nextError, 'Unable to sign out');
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
        signIn,
        bootstrapFirstAdmin,
        resetPassword,
        signOut,
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
