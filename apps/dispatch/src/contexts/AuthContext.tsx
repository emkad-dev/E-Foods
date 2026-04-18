import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { UserDocument } from '../domain/entities';
import {
  signInWithEmail,
  signOutUser,
  formatAuthError,
  sendPasswordReset,
} from '../services/firebase/auth';
import { auth, db } from '../services/firebase/config';
import {
  clearStoredSessionId,
  createSessionId,
  getStoredSessionId,
  storeSessionId,
} from '../services/firebase/session';
import { getUserDocument, updateUserDocument } from '../services/firebase/firestore';

type AuthContextType = {
  user: UserDocument | null;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string, userData?: Partial<UserDocument>) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DISPATCH_ACCESS_ERROR = 'This account does not have dispatch access.';
const MISSING_PROFILE_ERROR = 'No dispatch profile was found for this account.';
const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const SESSION_CONFLICT_ERROR = 'This account was signed in on another device. Sign in again here if you want to continue on this device.';
const DISPATCH_SIGNUP_DISABLED_ERROR = 'Dispatch account creation is admin-managed. Ask the platform team to create or invite this account first.';

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

const getDispatchAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
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

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserDocument | null>(null);
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);

      try {
        if (!firebaseUser) {
          setUser(null);
          return;
        }

        const userDocument = await getUserDocument(db, firebaseUser.uid);

        if (!userDocument) {
          await signOutUser(auth);
          setUser(null);
          setError(MISSING_PROFILE_ERROR);
          return;
        }

        if (userDocument.role !== 'dispatch') {
          await signOutUser(auth);
          setUser(null);
          setError(DISPATCH_ACCESS_ERROR);
          return;
        }

        const sessionIsValid = await syncSingleDeviceSession(userDocument);

        if (!sessionIsValid) {
          return;
        }

        setUser({
          ...userDocument,
          email: firebaseUser.email ?? userDocument.email,
          emailVerified: firebaseUser.emailVerified,
        });
      } catch (nextError) {
        const nextMessage = getDispatchAuthErrorMessage(nextError, 'Failed to load dispatch account');
        console.error('Error syncing dispatch auth state:', nextError);
        setUser(null);
        setError(nextMessage);
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

        if (nextUser.role !== 'dispatch') {
          await clearStoredSessionId();
          await signOutUser(auth);
          setUser(null);
          setError(DISPATCH_ACCESS_ERROR);
          return;
        }

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
        console.error('Error watching dispatch session:', snapshotError);
      }
    );

    return unsubscribe;
  }, [syncSingleDeviceSession, user?.uid]);

  const signUp = async (email: string, password: string, userData?: Partial<UserDocument>) => {
    setLoading(true);
    setError(null);

    try {
      void email;
      void password;
      void userData;
      throw new Error(DISPATCH_SIGNUP_DISABLED_ERROR);
    } catch (nextError: any) {
      const nextMessage =
        nextError?.message === DISPATCH_SIGNUP_DISABLED_ERROR
          ? DISPATCH_SIGNUP_DISABLED_ERROR
          : getDispatchAuthErrorMessage(nextError, 'Unable to sign up');
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
      const firebaseUser = await signInWithEmail(auth, email, password);
      const userDocument = await getUserDocument(db, firebaseUser.uid);

      if (!userDocument) {
        await signOutUser(auth);
        setUser(null);
        setError(MISSING_PROFILE_ERROR);
        throw new Error(MISSING_PROFILE_ERROR);
      }

      if (userDocument.role !== 'dispatch') {
        await signOutUser(auth);
        setUser(null);
        setError(DISPATCH_ACCESS_ERROR);
        throw new Error(DISPATCH_ACCESS_ERROR);
      }

      await startSingleDeviceSession(firebaseUser.uid);
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
      await sendPasswordReset(auth, email);
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
      await releaseSingleDeviceSession(auth.currentUser?.uid);
      await signOutUser(auth);
      setUser(null);
    } catch (nextError: any) {
      const nextMessage = nextError?.code ? formatAuthError(nextError) : nextError?.message ?? 'Unable to sign out';
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
