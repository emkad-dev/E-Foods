import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseUserRole, type AuthRole } from '../../../../../packages/auth/src';

const ACTION_CODE_CONFIGURATION_ERRORS = new Set(['redirect_to_not_allowed']);

export const isActionCodeConfigurationError = (error: AuthError | null | undefined) =>
  Boolean(error?.code && ACTION_CODE_CONFIGURATION_ERRORS.has(error.code));

export const createUserWithEmail = async (
  supabase: SupabaseClient,
  email: string,
  password: string
): Promise<User> => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error('Supabase did not return a user for this sign-up attempt.');
  }

  return data.user;
};

export const signInWithEmail = async (
  supabase: SupabaseClient,
  email: string,
  password: string
): Promise<User> => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error('Supabase did not return a user for this sign-in attempt.');
  }

  return data.user;
};

export const signOutUser = async (supabase: SupabaseClient) => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
};

export const getUserRoleClaim = async (user: User): Promise<AuthRole | null> => getSupabaseUserRole(user);

export const sendVerificationEmailWithFallback = async (
  supabase: SupabaseClient,
  email: string,
  actionCodeSettings?: { url: string }
) => {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: actionCodeSettings?.url
      ? {
          emailRedirectTo: actionCodeSettings.url,
        }
      : undefined,
  });

  if (error && isActionCodeConfigurationError(error)) {
    const fallback = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    if (fallback.error) {
      throw fallback.error;
    }

    return;
  }

  if (error) {
    throw error;
  }
};

export const sendPasswordResetEmailWithFallback = async (
  supabase: SupabaseClient,
  email: string,
  actionCodeSettings?: { url: string }
) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: actionCodeSettings?.url,
  });

  if (error && isActionCodeConfigurationError(error)) {
    const fallback = await supabase.auth.resetPasswordForEmail(email);
    if (fallback.error) {
      throw fallback.error;
    }
    return;
  }

  if (error) {
    throw error;
  }
};

export const signInWithGoogle = async (supabase: SupabaseClient, idToken: string): Promise<User> => {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error('Supabase did not return a user for this Google sign-in attempt.');
  }

  return data.user;
};

export const formatAuthError = (error: any): string => {
  const errorCode = error?.code || 'unknown-error';
  const errorMessage = error?.message || 'An unknown error occurred';

  const errorMap: Record<string, string> = {
    email_not_confirmed: 'Verify your email address before continuing',
    invalid_credentials: 'Incorrect email or password',
    over_request_rate_limit: 'Too many login attempts. Please try again later',
    signup_disabled: 'Email/password accounts are not enabled',
    user_already_exists: 'An account with this email already exists',
    weak_password: 'Password must be at least 6 characters',
    validation_failed: 'Please enter a valid email address',
    unexpected_failure: 'Network error. Check your internet connection and try again',
  };

  return errorMap[errorCode] || errorMessage;
};
