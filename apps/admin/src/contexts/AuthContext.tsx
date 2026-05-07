import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import type { UserDocument } from '../domain/entities';
import { formatAuthError, getUserRoleClaim, sendPasswordReset, signInWithEmail, signOutUser } from '../services/firebase/auth';
import { auth, db, functions } from '../services/firebase/config';
import {
  clearStoredSessionId,
  clearStoredUserProfile,
  createSessionId,
  getStoredSessionId,
  getStoredUserProfile,
  storeSessionId,
  storeUserProfile,
} from '../services/firebase/session';
import { getUserDocument, updateUserDocument } from '../services/firebase/firestore';

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
const SESSION_CONFLICT_ERROR = 'This admin account was signed in on another device. Sign in again here if you want to continue on this device.';
const BOOTSTRAP_WAIT_MESSAGE = 'Preparing first admin access...';

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

const getAdminAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
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
  const bootstrapInProgressRef = useRef(false);

  const clearLocalUserState = useCallback(async () => {
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile()]);
  }, []);

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

    try {
      if (userId && localSessionId) {
        const userDocument = await getUserDocument(db, userId);

        if (userDocument?.activeSessionId === localSessionId) {
          await updateUserDocument(db, userId, {
            activeSessionId: null,
            activeSessionUpdatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (releaseError) {
      if (!isFirestoreOfflineError(releaseError)) {
        console.warn('Unable to release admin session in Firestore:', releaseError);
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
      await signOutUser(auth);
      setUser(null);
      setError(SESSION_CONFLICT_ERROR);
      return false;
    }

    if (!localSessionId && remoteSessionId) {
      await storeSessionId(remoteSessionId);
    }

    return true;
  }, [clearLocalUserState]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);

      try {
        if (!firebaseUser) {
          setUser(null);
          await clearLocalUserState();
          return;
        }

        const claimRole = await getUserRoleClaim(firebaseUser);
        if (claimRole !== 'admin') {
          if (bootstrapInProgressRef.current) {
            setError(BOOTSTRAP_WAIT_MESSAGE);
            return;
          }

          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          setError(ADMIN_ACCESS_ERROR);
          return;
        }

        const userDocument = await getUserDocument(db, firebaseUser.uid);

        if (!userDocument) {
          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          setError(MISSING_PROFILE_ERROR);
          return;
        }

        const sessionIsValid = await syncSingleDeviceSession(userDocument);

        if (!sessionIsValid) {
          return;
        }

        const nextUser: UserDocument = {
          ...userDocument,
          email: firebaseUser.email ?? userDocument.email,
          emailVerified: firebaseUser.emailVerified,
          role: claimRole,
        };

        setUser(nextUser);
        await storeUserProfile(nextUser);
      } catch (nextError) {
        if (firebaseUser && isFirestoreOfflineError(nextError)) {
          const cachedUser = await getStoredUserProfile<UserDocument>();

          if (cachedUser?.uid === firebaseUser.uid && cachedUser.role === 'admin') {
            const fallbackUser: UserDocument = {
              ...cachedUser,
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? cachedUser.email,
              emailVerified: firebaseUser.emailVerified,
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

    return unsubscribe;
  }, [clearLocalUserState, syncSingleDeviceSession]);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      async (userSnapshot) => {
        if (!userSnapshot.exists()) {
          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          return;
        }

        const nextUser = userSnapshot.data() as UserDocument;
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) {
          await clearLocalUserState();
          setUser(null);
          return;
        }

        const claimRole = await getUserRoleClaim(currentFirebaseUser);
        if (claimRole !== 'admin') {
          if (bootstrapInProgressRef.current) {
            setError(BOOTSTRAP_WAIT_MESSAGE);
            return;
          }

          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          setError(ADMIN_ACCESS_ERROR);
          return;
        }

        const sessionIsValid = await syncSingleDeviceSession(nextUser);

        if (!sessionIsValid) {
          return;
        }

        setUser((currentUser) => {
          if (!currentUser) {
            return currentUser;
          }

          const resolvedUser = {
            ...currentUser,
            ...nextUser,
            email: auth.currentUser?.email ?? nextUser.email,
            emailVerified: auth.currentUser?.emailVerified ?? nextUser.emailVerified,
            role: claimRole,
          };

          void storeUserProfile(resolvedUser);
          return resolvedUser;
        });
      },
      (snapshotError) => {
        if (isFirestoreOfflineError(snapshotError)) {
          setError(NO_INTERNET_ERROR);
          return;
        }

        console.error('Error watching admin session:', snapshotError);
      }
    );

    return unsubscribe;
  }, [clearLocalUserState, syncSingleDeviceSession, user?.uid]);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const firebaseUser = await signInWithEmail(auth, email, password);
      const claimRole = await getUserRoleClaim(firebaseUser);

      if (claimRole !== 'admin') {
        await clearLocalUserState();
        await signOutUser(auth);
        setUser(null);
        setError(ADMIN_ACCESS_ERROR);
        throw new Error(ADMIN_ACCESS_ERROR);
      }

      const userDocument = await getUserDocument(db, firebaseUser.uid);

      if (!userDocument) {
        await clearLocalUserState();
        await signOutUser(auth);
        setUser(null);
        setError(MISSING_PROFILE_ERROR);
        throw new Error(MISSING_PROFILE_ERROR);
      }

      await startSingleDeviceSession(firebaseUser.uid);
    } catch (nextError: any) {
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
      const firebaseUser = await signInWithEmail(auth, email, password);
      const bootstrapCallable = httpsCallable<Record<string, never>, { role: string }>(functions, 'bootstrapFirstAdmin');
      await bootstrapCallable({});
      const claimRole = await getUserRoleClaim(firebaseUser, true);

      if (claimRole !== 'admin') {
        throw new Error('Bootstrap completed, but the admin claim has not refreshed yet. Sign in again in a moment.');
      }

      const userDocument = await getUserDocument(db, firebaseUser.uid);

      if (!userDocument) {
        throw new Error(MISSING_PROFILE_ERROR);
      }

      await startSingleDeviceSession(firebaseUser.uid);

      const nextUser: UserDocument = {
        ...userDocument,
        email: firebaseUser.email ?? userDocument.email,
        emailVerified: firebaseUser.emailVerified,
        role: claimRole,
      };

      setUser(nextUser);
      await storeUserProfile(nextUser);
    } catch (nextError: any) {
      if (auth.currentUser) {
        try {
          await signOutUser(auth);
        } catch (signOutError) {
          console.warn('Unable to clear partial bootstrap session:', signOutError);
        }
      }

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
      await sendPasswordReset(auth, email);
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
      await releaseSingleDeviceSession(auth.currentUser?.uid);
      await signOutUser(auth);
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
