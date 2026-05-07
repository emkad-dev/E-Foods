import { Auth, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, User, getIdTokenResult } from 'firebase/auth';

export type AuthRole = 'customer' | 'restaurant' | 'dispatch' | 'admin';

const isAuthRole = (value: unknown): value is AuthRole =>
  value === 'customer' || value === 'restaurant' || value === 'dispatch' || value === 'admin';

export const signInWithEmail = async (auth: Auth, email: string, password: string) => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};

export const signOutUser = async (auth: Auth) => {
  await signOut(auth);
};

export const sendPasswordReset = async (auth: Auth, email: string) => {
  await sendPasswordResetEmail(auth, email);
};

export const getUserRoleClaim = async (user: User, forceRefresh = false): Promise<AuthRole | null> => {
  const tokenResult = await getIdTokenResult(user, forceRefresh);
  const role = tokenResult.claims?.role;
  return isAuthRole(role) ? role : null;
};

export const formatAuthError = (error: any): string => {
  const errorCode = error?.code || 'unknown-error';
  const errorMessage = error?.message || 'An unknown error occurred';

  const errorMap: Record<string, string> = {
    'auth/user-not-found': 'No admin account found with this email address',
    'auth/wrong-password': 'Incorrect password',
    'auth/invalid-credential': 'Incorrect email or password',
    'auth/invalid-email': 'Please enter a valid email address',
    'auth/user-disabled': 'This admin account has been disabled',
    'auth/too-many-requests': 'Too many login attempts. Please try again later',
    'auth/network-request-failed': 'Network error. Check your internet connection and try again',
    'auth/missing-email': 'Enter the email address linked to your admin account',
  };

  return errorMap[errorCode] || errorMessage;
};
