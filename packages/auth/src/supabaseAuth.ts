import type { AuthError, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseUserRole } from './claims.js';
import type { AuthRole } from './types';

const ACTION_CODE_CONFIGURATION_ERRORS = new Set(['redirect_to_not_allowed']);
const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'fetch failed',
  'network request failed',
  'networkerror',
  'load failed',
  'request failed',
];

export const isNetworkRequestError = (error: unknown) => {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as any).message ?? '').toLowerCase()
      : '';

  if (!message) {
    return false;
  }

  return NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

export const isActionCodeConfigurationError = (error: AuthError | null | undefined) =>
  Boolean(error?.code && ACTION_CODE_CONFIGURATION_ERRORS.has(error.code));

/**
 * Sign-up itself sends the confirmation email, so the redirect has to ride along here.
 * Without it Supabase falls back to the project Site URL and every app's verification
 * link lands on the marketing site instead of the app that asked for the address.
 */
export const createUserWithEmail = async (
  supabase: SupabaseClient,
  email: string,
  password: string,
  metadata?: Record<string, unknown>,
  actionCodeSettings?: { url: string }
): Promise<{ user: User; session: Session | null }> => {
  const buildOptions = (emailRedirectTo?: string) => {
    if (!metadata && !emailRedirectTo) {
      return undefined;
    }

    return {
      ...(metadata ? { data: metadata } : {}),
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    };
  };

  let { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: buildOptions(actionCodeSettings?.url),
  });

  if (error && isActionCodeConfigurationError(error)) {
    ({ data, error } = await supabase.auth.signUp({
      email,
      password,
      options: buildOptions(),
    }));
  }

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error('Supabase did not return a user for this sign-up attempt.');
  }

  return {
    user: data.user,
    session: data.session ?? null,
  };
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

/**
 * Confirms a signup with the 6-digit code from the verification email.
 *
 * This is the redirect-free half of email confirmation: no emailRedirectTo, no
 * redirect allowlist entry, and nothing tied to the app's hostname — which is
 * why it survives a domain move that would invalidate emailed links.
 *
 * Requires the Supabase "Confirm signup" template to expose {{ .Token }}. A
 * template carrying both the token and the confirmation URL lets the link and
 * the code work at the same time, so existing emails keep working.
 */
export const verifyEmailOtp = async (supabase: SupabaseClient, email: string, token: string) => {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: token.trim(),
    type: 'signup',
  });

  if (error) {
    throw error;
  }

  return data;
};

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
