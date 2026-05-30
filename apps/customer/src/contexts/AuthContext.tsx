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
  getUserRoleClaim,
  signInWithEmail,
  signOutUser,
  signInWithGoogle,
} from '../services/supabase/auth';
import {
  clearStoredUserProfile,
  clearStoredSessionId,
  createSessionId,
  getStoredUserProfile,
  getStoredSessionId,
  storeSessionId,
  storeUserProfile,
} from '../services/session';
import { getUserDocument, createUserDocument, updateUserDocument } from '../services/supabase/profile';
import { supabase } from '../services/supabase/config';
import { deleteOwnAccount as deleteOwnCustomerAccount } from '../services/accountManagement';

export type User = UserDocument | null;

type SignUpResult = {
  verificationEmailSent: boolean;
};

interface AuthContextType {
  user: User;
  loading: boolean;
  error: string | null;
  signUp: (
    email: string,
    password: string,
    userData?: {
      displayName?: string;
      phoneNumber?: string;
    }
  ) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
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

const getCustomerAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (isOfflineError(error)) {
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
  return {
    url: `${appEnv.appScheme}://${path}`,
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearLocalUserState = useCallback(async () => {
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile()]);
  }, []);

  const buildNextUser = useCallback(
    async (authUser: SupabaseAuthUser) => {
      let userData = await getUserDocument(authUser.id);

      if (!userData) {
        userData = await createUserDocument(authUser.id, {
          email: authUser.email ?? '',
          emailVerified: Boolean(authUser.email_confirmed_at),
          role: DEFAULT_APP_ROLE,
          displayName: (authUser.user_metadata?.full_name as string | undefined) ?? undefined,
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

  /**
   * Listen for authentication state changes and sync user profile
   */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event: AuthChangeEvent, session: Session | null) => {
      setLoading(true);
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

          setUser(nextUser);
          await storeUserProfile(nextUser);
        } else {
          setUser(null);
          await clearLocalUserState();
        }
      } catch (err) {
        const authUser = session?.user ?? null;
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

        console.error('Error syncing user authentication state:', err);
        setError(getCustomerAuthErrorMessage(err, 'Failed to load user data'));
        setUser(null);
        await clearStoredUserProfile();
      } finally {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [buildNextUser, clearLocalUserState, syncSingleDeviceSession]);

  const signUp = async (
    email: string,
    password: string,
    userData?: {
      displayName?: string;
      phoneNumber?: string;
    }
  ): Promise<SignUpResult> => {
    setLoading(true);
    setError(null);

    try {
      const authUser = await createUserWithEmail(supabase, email, password, {
        displayName: userData?.displayName,
      });
      await createUserDocument(authUser.id, {
        email: authUser.email ?? '',
        role: DEFAULT_APP_ROLE,
        emailVerified: Boolean(authUser.email_confirmed_at),
        ...userData,
      });
      await startSingleDeviceSession(authUser.id);

      try {
        await sendVerificationEmailWithFallback(
          supabase,
          authUser.email ?? email,
          getActionCodeSettings(appEnv.verifyEmailPath)
        );
        return { verificationEmailSent: true };
      } catch (verificationError) {
        console.warn('Account created, but verification email could not be sent:', verificationError);
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
      await startSingleDeviceSession(authUser.id);
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
      const userData = await getUserDocument(authUser.id);

      if (!userData) {
        await createUserDocument(authUser.id, {
          email: authUser.email ?? '',
          displayName: (authUser.user_metadata?.full_name as string | undefined) ?? undefined,
          photoURL: (authUser.user_metadata?.avatar_url as string | undefined) ?? undefined,
          role: DEFAULT_APP_ROLE,
          emailVerified: Boolean(authUser.email_confirmed_at),
        });
      } else {
        const claimRole = await getUserRoleClaim(authUser);
        if (claimRole && claimRole !== DEFAULT_APP_ROLE) {
          await clearLocalUserState();
          await signOutUser(supabase);
          setUser(null);
          setError(CUSTOMER_ACCESS_ERROR);
          throw new Error(CUSTOMER_ACCESS_ERROR);
        }
        await updateUserDocument(authUser.id, {
          displayName: (authUser.user_metadata?.full_name as string | undefined) ?? undefined,
          photoURL: (authUser.user_metadata?.avatar_url as string | undefined) ?? undefined,
        });
      }

      await startSingleDeviceSession(authUser.id);
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
      router.replace('/(auth)/login');
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
      router.replace('/(auth)/login');
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

  const resetPassword = async (email: string): Promise<void> => {
    setError(null);

    try {
      await sendPasswordResetEmailWithFallback(
        supabase,
        email,
        getActionCodeSettings(appEnv.resetPasswordPath)
      );
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
      }

      return emailVerified;
    } catch (err) {
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
        error,
        signUp,
        signIn,
        signInWithGoogle: signInWithGoogleAuth,
        signOut,
        resetPassword,
        deleteAccount,
        updateDisplayName,
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
