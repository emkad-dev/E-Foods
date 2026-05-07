import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, reload } from 'firebase/auth';
import { router } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { UserDocument } from '../domain/entities';
import { DEFAULT_APP_ROLE } from '../domain/roles';
import { auth, db, functions } from '../services/firebase/config';
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
} 
from '../services/firebase/auth';
import {
  clearStoredUserProfile,
  clearStoredSessionId,
  createSessionId,
  getStoredUserProfile,
  getStoredSessionId,
  storeSessionId,
  storeUserProfile,
} from '../services/firebase/session';
import {
  getUserDocument,
  createUserDocument,
  updateUserDocument,
} 
from '../services/firebase/firestore';
import { deleteOwnAccount as deleteOwnCustomerAccount } from '../services/accountManagement';

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
  deleteAccount: () => Promise<void>;
  reloadUser: () => Promise<boolean>;
  sendVerificationEmail: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const CUSTOMER_ACCESS_ERROR = 'This account does not have customer access.';
const SESSION_CONFLICT_ERROR = 'This account was signed in on another device. Sign in again here if you want to continue on this device.';
const AUTH_SYNC_BACKEND_NOT_READY_ERROR =
  'Customer auth sync is not available yet. Deploy the latest Firebase Functions and try again.';

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

const isMissingAuthSyncCallableError = (error: unknown) => {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String((error as any).code) : '';
  const errorMessage =
    typeof error === 'object' && error !== null && 'message' in error ? String((error as any).message).toLowerCase() : '';

  return (
    errorCode === 'not-found' ||
    errorCode === 'functions/not-found' ||
    errorMessage.includes('syncuserclaims') ||
    errorMessage.includes('function') && errorMessage.includes('not found')
  );
};

const getCustomerAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (isFirestoreOfflineError(error)) {
    return NO_INTERNET_ERROR;
  }

  if (isMissingAuthSyncCallableError(error)) {
    return AUTH_SYNC_BACKEND_NOT_READY_ERROR;
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

  const clearLocalUserState = useCallback(async () => {
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile()]);
  }, []);

  const syncCustomerRoleClaim = useCallback(async () => {
    const callable = httpsCallable(functions, 'syncUserClaims');
    await callable({});

    if (!auth.currentUser) {
      return null;
    }

    return getUserRoleClaim(auth.currentUser, true);
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
        console.warn('Unable to release customer session in Firestore:', releaseError);
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

  /**
   * Listen for authentication state changes and sync with Firestore
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      try {
        if (firebaseUser) {
          let userData = await getUserDocument(db, firebaseUser.uid);

          if (!userData) {
            await createUserDocument(db, firebaseUser.uid, {
              email: firebaseUser.email ?? '',
              emailVerified: firebaseUser.emailVerified,
              role: DEFAULT_APP_ROLE,
            });
            userData = {
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              emailVerified: firebaseUser.emailVerified,
              role: DEFAULT_APP_ROLE,
              createdAt: new Date().toISOString(),
            };
          }

          let claimRole = await getUserRoleClaim(firebaseUser);

          if (!claimRole) {
            claimRole = await syncCustomerRoleClaim();
          }

          if (claimRole && claimRole !== DEFAULT_APP_ROLE) {
            await clearLocalUserState();
            await signOutUser(auth);
            setUser(null);
            setError(CUSTOMER_ACCESS_ERROR);
            return;
          }

          const nextUser: UserDocument = {
            ...userData,
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? userData.email ?? '',
            emailVerified: firebaseUser.emailVerified,
            role: DEFAULT_APP_ROLE,
          };

          const sessionIsValid = await syncSingleDeviceSession(nextUser);

          if (!sessionIsValid) {
            return;
          }

          setUser(nextUser);
          await storeUserProfile(nextUser);
        } 
        else {
          setUser(null);
          await clearLocalUserState();
        }
      } catch (err) {
        if (firebaseUser && isFirestoreOfflineError(err)) {
          const cachedUser = await getStoredUserProfile<UserDocument>();

          if (cachedUser?.uid === firebaseUser.uid) {
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

        console.error('Error syncing user authentication state:', err);
        setError(getCustomerAuthErrorMessage(err, 'Failed to load user data'));
        setUser(null);
        await clearStoredUserProfile();
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [clearLocalUserState, syncCustomerRoleClaim, syncSingleDeviceSession]);

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
        if (claimRole && claimRole !== DEFAULT_APP_ROLE) {
          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          setError(CUSTOMER_ACCESS_ERROR);
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
            role: DEFAULT_APP_ROLE,
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

        console.error('Error watching customer session:', snapshotError);
      }
    );

    return unsubscribe;
  }, [clearLocalUserState, syncSingleDeviceSession, user?.uid]);

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

      await syncCustomerRoleClaim();

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
      let claimRole = await getUserRoleClaim(firebaseUser);

      if (!claimRole) {
        claimRole = await syncCustomerRoleClaim();
      }

      if (claimRole && claimRole !== DEFAULT_APP_ROLE) {
        await clearLocalUserState();
        await signOutUser(auth);
        setUser(null);
        setError(CUSTOMER_ACCESS_ERROR);
        throw new Error(CUSTOMER_ACCESS_ERROR);
      }

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
        await syncCustomerRoleClaim();
      } 
      else {
        let claimRole = await getUserRoleClaim(firebaseUser);

        if (!claimRole) {
          claimRole = await syncCustomerRoleClaim();
        }

        if (claimRole && claimRole !== DEFAULT_APP_ROLE) {
          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          setError(CUSTOMER_ACCESS_ERROR);
          throw new Error(CUSTOMER_ACCESS_ERROR);
        }

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
      await clearLocalUserState();
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

  const deleteAccount = async (): Promise<void> => {
    if (!auth.currentUser) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    setLoading(true);
    setError(null);

    try {
      await deleteOwnCustomerAccount();
      await signOutUser(auth).catch(() => undefined);
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
        deleteAccount,
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
