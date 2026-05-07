// src/services/firebase/auth.ts
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  getIdTokenResult,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  User as FirebaseAuthUser,
  Auth,
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth';

export interface AuthError {
  code: string;
  message: string;
}

export type AuthRole = 'customer' | 'restaurant' | 'dispatch' | 'admin';

const isAuthRole = (value: unknown): value is AuthRole =>
  value === 'customer' || value === 'restaurant' || value === 'dispatch' || value === 'admin';

/**
 * Firebase action code configuration errors that require fallback handling
 */
const ACTION_CODE_CONFIGURATION_ERRORS = new Set([
  'auth/configuration-not-found',
  'auth/invalid-continue-uri',
  'auth/missing-continue-uri',
  'auth/unauthorized-continue-uri',
  'auth/invalid-dynamic-link-domain',
]);

/**
 * Check if an error is an action code configuration error
 */
export const isActionCodeConfigurationError = (error: any): boolean => {
  return ACTION_CODE_CONFIGURATION_ERRORS.has(error?.code);
};

/**
 * Create a new user with email and password
 */
export const createUserWithEmail = async (
  auth: Auth,
  email: string,
  password: string
): Promise<FirebaseAuthUser> => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};

/**
 * Sign in user with email and password
 */
export const signInWithEmail = async (
  auth: Auth,
  email: string,
  password: string
): Promise<FirebaseAuthUser> => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};

/**
 * Sign out the current user
 */
export const signOutUser = async (auth: Auth): Promise<void> => {
  await signOut(auth);
};

export const getUserRoleClaim = async (
  firebaseUser: FirebaseAuthUser,
  forceRefresh = false
): Promise<AuthRole | null> => {
  const tokenResult = await getIdTokenResult(firebaseUser, forceRefresh);
  const role = tokenResult.claims?.role;
  return isAuthRole(role) ? role : null;
};

/**
 * Send verification email with fallback
 */
export const sendVerificationEmailWithFallback = async (
  firebaseUser: FirebaseAuthUser,
  actionCodeSettings?: { url: string }
): Promise<void> => {
  try {
    if (actionCodeSettings?.url) {
      await sendEmailVerification(firebaseUser, actionCodeSettings);
    } else {
      await sendEmailVerification(firebaseUser);
    }
  } catch (error: any) {
    // If action code configuration error, try without custom settings
    if (isActionCodeConfigurationError(error)) {
      await sendEmailVerification(firebaseUser);
    } else {
      throw error;
    }
  }
};

/**
 * Send password reset email with fallback
 */
export const sendPasswordResetEmailWithFallback = async (
  auth: Auth,
  email: string,
  actionCodeSettings?: { url: string }
): Promise<void> => {
  try {
    if (actionCodeSettings?.url) {
      await sendPasswordResetEmail(auth, email, actionCodeSettings);
    } else {
      await sendPasswordResetEmail(auth, email);
    }
  } catch (error: any) {
    // If action code configuration error, try without custom settings
    if (isActionCodeConfigurationError(error)) {
      await sendPasswordResetEmail(auth, email);
    } else {
      throw error;
    }
  }
};

/**
 * Format Firebase auth error message for user display
 */
export const formatAuthError = (error: any): string => {
  const errorCode = error?.code || 'unknown-error';
  const errorMessage = error?.message || 'An unknown error occurred';

  const errorMap: Record<string, string> = {
    'auth/user-not-found': 'No account found with this email address',
    'auth/wrong-password': 'Incorrect password',
    'auth/invalid-credential': 'Incorrect email or password',
    'auth/invalid-email': 'Please enter a valid email address',
    'auth/user-disabled': 'This account has been disabled',
    'auth/email-already-in-use': 'An account with this email already exists',
    'auth/weak-password': 'Password must be at least 6 characters',
    'auth/operation-not-allowed': 'Email/password accounts are not enabled',
    'auth/too-many-requests': 'Too many login attempts. Please try again later',
    'auth/network-request-failed': 'Network error. Check your internet connection and try again',
    'auth/missing-email': 'Enter the email address linked to your account',
  };

  return errorMap[errorCode] || errorMessage;
};

/**
 * Handle Google Sign-In (for use with @react-native-google-signin/google-signin)
 * Call this with the idToken from Google Sign-In
 */
export const signInWithGoogle = async (
  auth: Auth,
  idToken: string
): Promise<FirebaseAuthUser> => {
  try {
    const credential = GoogleAuthProvider.credential(idToken);
    const userCredential = await signInWithCredential(auth, credential);
    return userCredential.user;
  } catch (error: any) {
    console.error('Google Sign-In error:', error);
    throw error;
  }
};

/**
 * Check if Google Sign-In is available (utility function)
 */
export const isGoogleSignInAvailable = (): boolean => {
  return GoogleAuthProvider !== undefined;
};
