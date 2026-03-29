import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, reload } from 'firebase/auth';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { auth, db } from '../services/firebase/config';
import {
  sendVerificationEmailWithFallback,
  sendPasswordResetEmailWithFallback,
  formatAuthError,
  createUserWithEmail,
  signInWithEmail,
  signOutUser,
  signInWithGoogle,
} from '../services/firebase/auth';
import {
  getUserDocument,
  createUserDocument,
  updateUserDocument,
} from '../services/firebase/firestore';

export type User = {
  uid: string;
  email: string;
  role: 'customer' | 'restaurant' | 'dispatch';
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
} | null;

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
  reloadUser: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Get the app domain from environment variables for action code settings
 */
const getActionCodeSettings = (path: string) => {
  const appDomain = Constants.expoConfig?.extra?.EXPO_PUBLIC_APP_DOMAIN || 'ebuy.com';
  return {
    url: `https://${appDomain}/${path}`,
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            // User document exists, use it
            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              emailVerified: firebaseUser.emailVerified,
              role: userData.role,
              displayName: userData.displayName,
              photoURL: userData.photoURL,
            });
          } else {
            // Create user document if it doesn't exist
            await createUserDocument(db, firebaseUser.uid, {
              email: firebaseUser.email ?? '',
              emailVerified: firebaseUser.emailVerified,
              role: 'customer',
            });

            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              emailVerified: firebaseUser.emailVerified,
              role: 'customer',
            });
          }
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('Error syncing user authentication state:', err);
        setError('Failed to load user data');
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signUp = async (email: string, password: string, userData?: any): Promise<SignUpResult> => {
    setLoading(true);
    setError(null);

    try {
      // Create user with email and password
      const firebaseUser = await createUserWithEmail(auth, email, password);

      // Create user document in Firestore
      await createUserDocument(db, firebaseUser.uid, {
        email: firebaseUser.email ?? '',
        role: 'customer',
        emailVerified: false,
        ...userData,
      });

      // Send verification email
      try {
        const verifyPath = Constants.expoConfig?.extra?.EXPO_PUBLIC_VERIFY_EMAIL_PATH || 'verify-email';
        await sendVerificationEmailWithFallback(
          firebaseUser,
          getActionCodeSettings(verifyPath)
        );
        return { verificationEmailSent: true };
      } catch (verificationError) {
        console.warn('Account created, but verification email could not be sent:', verificationError);
        return { verificationEmailSent: false };
      }
    } catch (err: any) {
      const formattedError = formatAuthError(err);
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
      await signInWithEmail(auth, email, password);
    } catch (err: any) {
      const formattedError = formatAuthError(err);
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
          role: 'customer',
          emailVerified: firebaseUser.emailVerified,
        });
      } else {
        // Existing user - update profile if needed
        await updateUserDocument(db, firebaseUser.uid, {
          displayName: firebaseUser.displayName ?? undefined,
          photoURL: firebaseUser.photoURL ?? undefined,
        });
      }
    } catch (err: any) {
      const formattedError = formatAuthError(err);
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
      await signOutUser(auth);
      setUser(null);
      router.replace('/(auth)/login');
    } catch (err: any) {
      const formattedError = formatAuthError(err);
      setError(formattedError);
      throw new Error(formattedError);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string): Promise<void> => {
    setError(null);

    try {
      const resetPath = Constants.expoConfig?.extra?.EXPO_PUBLIC_RESET_PASSWORD_PATH || 'reset-password';
      await sendPasswordResetEmailWithFallback(
        auth,
        email,
        getActionCodeSettings(resetPath)
      );
    } catch (err: any) {
      const formattedError = formatAuthError(err);
      setError(formattedError);
      throw new Error(formattedError);
    }
  };

  const reloadUser = async (): Promise<void> => {
    if (!auth.currentUser) return;

    try {
      await reload(auth.currentUser);

      setUser((currentUser) =>
        currentUser
          ? {
              ...currentUser,
              emailVerified: auth.currentUser?.emailVerified ?? currentUser.emailVerified,
            }
          : currentUser
      );

      // Update Firestore if email is now verified
      if (auth.currentUser.emailVerified) {
        await updateUserDocument(db, auth.currentUser.uid, {
          emailVerified: true,
        }).catch((err) => console.error('Error updating email verification status:', err));
      }
    } catch (err) {
      console.error('Error reloading user:', err);
      setError('Failed to reload user data');
      throw err;
    }
  };

  const sendVerificationEmail = async (): Promise<void> => {
    if (!auth.currentUser) {
      setError('No user is currently signed in');
      return;
    }

    try {
      const verifyPath = Constants.expoConfig?.extra?.EXPO_PUBLIC_VERIFY_EMAIL_PATH || 'verify-email';
      await sendVerificationEmailWithFallback(
        auth.currentUser,
        getActionCodeSettings(verifyPath)
      );
    } catch (err: any) {
      const formattedError = formatAuthError(err);
      setError(formattedError);
      throw new Error(formattedError);
    }
  };

  const clearError = (): void => {
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
