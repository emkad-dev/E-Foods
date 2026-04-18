import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, reload } from 'firebase/auth';
import { router } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import type { UserDocument } from '../domain/entities';
import { DEFAULT_APP_ROLE } from '../domain/roles';
import { auth, db } from '../services/firebase/config';
import { appEnv } from '../config/env';
import {
  sendVerificationEmailWithFallback,
  sendPasswordResetEmailWithFallback,
  formatAuthError,
  createUserWithEmail,
  signInWithEmail,
  signOutUser,
  signInWithGoogle,
} 
from '../services/firebase/auth';
import {
  clearStoredSessionId,
  createSessionId,
  getStoredSessionId,
  storeSessionId,
} from '../services/firebase/session';
import {
  getUserDocument,
  createUserDocument,
  updateUserDocument,
} 
from '../services/firebase/firestore';

export type User = UserDocument | null;

type SignUpResult = {
  verificationEmailSent: boolean;
};

interface AuthContextType {
  user: User;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string, userData?: any) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  reloadUser: () => Promise<boolean>;
  sendVerificationEmail: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const SESSION_CONFLICT_ERROR = 'This account was signed in on another device. Sign in again here if you want to continue on this device.';

const isFirestoreOfflineError = (error: unknown) => {
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
  if (isFirestoreOfflineError(error)) {
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
    url: `https://${appEnv.appDomain}/${path}`,
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startSingleDeviceSession = useCallback(async (userId: string) => {
    const sessionId = createSessionId();

    await updateUserDocument(db, userId, {
      activeSessionId: sessionId,
      activeSessionUpdatedAt: new Date().toISOString(),
    });
    await storeSessionId(sessionId);
  }, []);

  const releaseSingleDeviceSession = useCallback(async (userId?: string | null) => {
    const localSessionId = await getStoredSessionId();

    if (userId && localSessionId) {
      const userDocument = await getUserDocument(db, userId);

      if (userDocument?.activeSessionId === localSessionId) {
        await updateUserDocument(db, userId, {
          activeSessionId: null,
          activeSessionUpdatedAt: new Date().toISOString(),
        });
      }
    }

    await clearStoredSessionId();
  }, []);

  const syncSingleDeviceSession = useCallback(async (userDocument: UserDocument) => {
    const localSessionId = await getStoredSessionId();
    const remoteSessionId = userDocument.activeSessionId ?? null;

    if (localSessionId && remoteSessionId && localSessionId !== remoteSessionId) {
      await clearStoredSessionId();
      await signOutUser(auth);
      setUser(null);
      setError(SESSION_CONFLICT_ERROR);
      return false;
    }

    if (!localSessionId && remoteSessionId) {
      await storeSessionId(remoteSessionId);
    }

    return true;
  }, []);

  /**
   * Listen for authentication state changes and sync with Firestore
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      try {
        if (firebaseUser) {
          // Get user data from Firestore
          const userData = await getUserDocument(db, firebaseUser.uid);

          if (userData) {
            const nextUser: UserDocument = {
              ...userData,
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              emailVerified: firebaseUser.emailVerified,
            };

            const sessionIsValid = await syncSingleDeviceSession(nextUser);

            if (!sessionIsValid) {
              return;
            }

            // User document exists, use it
            setUser(nextUser);
          } else {
            // Create user document if it doesn't exist
            await createUserDocument(db, firebaseUser.uid, {
              email: firebaseUser.email ?? '',
              emailVerified: firebaseUser.emailVerified,
              role: DEFAULT_APP_ROLE,
            });

            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              emailVerified: firebaseUser.emailVerified,
              role: DEFAULT_APP_ROLE,
              createdAt: new Date().toISOString(),
            });
          }
        } 
        else {
          setUser(null);
        }
      } catch (err) {
        console.error('Error syncing user authentication state:', err);
        setError(getCustomerAuthErrorMessage(err, 'Failed to load user data'));
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [syncSingleDeviceSession]);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      async (userSnapshot) => {
        if (!userSnapshot.exists()) {
          await clearStoredSessionId();
          await signOutUser(auth);
          setUser(null);
          return;
        }

        const nextUser = userSnapshot.data() as UserDocument;
        const sessionIsValid = await syncSingleDeviceSession(nextUser);

        if (!sessionIsValid) {
          return;
        }

        setUser((currentUser) =>
          currentUser
            ? {
                ...currentUser,
                ...nextUser,
                email: auth.currentUser?.email ?? nextUser.email,
                emailVerified: auth.currentUser?.emailVerified ?? nextUser.emailVerified,
              }
            : currentUser
        );
      },
      (snapshotError) => {
        console.error('Error watching customer session:', snapshotError);
      }
    );

    return unsubscribe;
  }, [syncSingleDeviceSession, user?.uid]);

  const signUp = async (email: string, password: string, userData?: any): Promise<SignUpResult> => {
    setLoading(true);
    setError(null);

    try {
      // Create user with email and password
      const firebaseUser = await createUserWithEmail(auth, email, password);

      // Create user document in Firestore
      await createUserDocument(db, firebaseUser.uid, {
        email: firebaseUser.email ?? '',
        role: DEFAULT_APP_ROLE,
        emailVerified: false,
        ...userData,
      });

      await startSingleDeviceSession(firebaseUser.uid);

      // Send verification email
      try {
        await sendVerificationEmailWithFallback(
          firebaseUser,
          getActionCodeSettings(appEnv.verifyEmailPath)
        );
        return { verificationEmailSent: true };
      } 
      catch (verificationError) {
        console.warn('Account created, but verification email could not be sent:', verificationError);
        return { verificationEmailSent: false };
      }
    } 
    
    catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to create account');
      setError(formattedError);
      throw new Error(formattedError);
    } 
    finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const firebaseUser = await signInWithEmail(auth, email, password);
      await startSingleDeviceSession(firebaseUser.uid);
    } 
    catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to sign in');
      setError(formattedError);
      throw new Error(formattedError);
    } 
    finally {
      setLoading(false);
    }
  };

  const signInWithGoogleAuth = async (idToken: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      // Sign in or create user with Google
      const firebaseUser = await signInWithGoogle(auth, idToken);

      // Check if user document exists
      const userData = await getUserDocument(db, firebaseUser.uid);

      if (!userData) {
        // New user - create document
        await createUserDocument(db, firebaseUser.uid, {
          email: firebaseUser.email ?? '',
          displayName: firebaseUser.displayName ?? undefined,
              photoURL: firebaseUser.photoURL ?? undefined,
              role: DEFAULT_APP_ROLE,
              emailVerified: firebaseUser.emailVerified,
            });
      } 
      else {
        // Existing user - update profile if needed
        await updateUserDocument(db, firebaseUser.uid, {
          displayName: firebaseUser.displayName ?? undefined,
          photoURL: firebaseUser.photoURL ?? undefined,
        });
      }

      await startSingleDeviceSession(firebaseUser.uid);
    } 
    catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to complete Google sign-in');
      setError(formattedError);
      throw new Error(formattedError);
    } 
    finally {
      setLoading(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      await releaseSingleDeviceSession(auth.currentUser?.uid);
      await signOutUser(auth);
      setUser(null);
      router.replace('/(auth)/login');
    } 
    catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to sign out');
      setError(formattedError);
      throw new Error(formattedError);
    } 
    finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string): Promise<void> => {
    setError(null);

    try {
      await sendPasswordResetEmailWithFallback(
        auth,
        email,
        getActionCodeSettings(appEnv.resetPasswordPath)
      );
    } 
    catch (err: any) {
      const formattedError = getCustomerAuthErrorMessage(err, 'Unable to send reset email');
      setError(formattedError);
      throw new Error(formattedError);
    }
  };

  const reloadUser = async (): Promise<boolean> => {
    if (!auth.currentUser) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    try {
      await reload(auth.currentUser);
      const emailVerified = auth.currentUser.emailVerified;

      setUser((currentUser) =>
        currentUser
          ? {
              ...currentUser,
              emailVerified,
            }
          : currentUser
      );

      // Update Firestore if email is now verified
      if (emailVerified) {
        await updateUserDocument(db, auth.currentUser.uid, {
          emailVerified: true,
        }).catch((err) => console.error('Error updating email verification status:', err));
      }

      return emailVerified;
    } 
    catch (err) {
      console.error('Error reloading user:', err);
      setError(getCustomerAuthErrorMessage(err, 'Failed to reload user data'));
      throw err;
    }
  };

  const sendVerificationEmail = async (): Promise<void> => {
    if (!auth.currentUser) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    try {
      await sendVerificationEmailWithFallback(
        auth.currentUser,
        getActionCodeSettings(appEnv.verifyEmailPath)
      );
    } 
    catch (err: any) {
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
