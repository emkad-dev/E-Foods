import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseUserRole } from './claims.js';
import type { AuthRole } from './types';

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

/**
 * Sign-up itself sends the confirmation email.
 *
 * No `emailRedirectTo` is passed, deliberately: email confirmation is OTP-only.
 * The email carries a 6-digit `{{ .Token }}` the user types into the app, so
 * there is no link whose destination would need steering, no redirect-allowlist
 * entry to maintain, and nothing tied to the app's hostname. Confirm the code
 * with `verifyEmailOtp` below.
 *
 * Whether the email body is a code or a link is decided by the Supabase email
 * template (dashboard-only, outside this repo). This function's contract is
 * only that the app never asks for a redirect.
 */
export const createUserWithEmail = async (
  supabase: SupabaseClient,
  email: string,
  password: string,
  metadata?: Record<string, unknown>
): Promise<{ user: User; session: Session | null }> => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: metadata ? { data: metadata } : undefined,
  });

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
 * This is the whole of email confirmation now: no emailRedirectTo, no redirect
 * allowlist entry, and nothing tied to the app's hostname — which is why it
 * survives a domain move that would invalidate emailed links.
 *
 * Requires the Supabase "Confirm signup" template to expose {{ .Token }}. That
 * template is dashboard-only and cannot be asserted from this repo.
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

/**
 * Confirms a password reset with the 6-digit code from the recovery email.
 *
 * TWO-STEP CONTRACT — this call does NOT change the password. Verifying a
 * `recovery` OTP establishes a real, fully authenticated session for that user;
 * `supabase.auth.updateUser({ password })` is then what actually writes the new
 * password, authorised by the session this call just created. So the caller
 * must do both, in this order, and treat a failure of either as "the reset did
 * not happen". Sign out afterwards if the screen expects the user to log in
 * again — the recovery session outlives the update.
 *
 * Requires the Supabase "Reset password" template to expose {{ .Token }}. That
 * template is dashboard-only and cannot be asserted from this repo.
 */
export const verifyPasswordResetOtp = async (supabase: SupabaseClient, email: string, token: string) => {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: token.trim(),
    type: 'recovery',
  });

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Re-sends the signup confirmation. No `emailRedirectTo`: the resent email is
 * the same OTP email, confirmed through `verifyEmailOtp`.
 *
 * The `WithFallback` name is historical — it once retried without a redirect
 * when the project rejected one. With no redirect ever sent, that branch was
 * unreachable and has been removed.
 */
export const sendVerificationEmailWithFallback = async (supabase: SupabaseClient, email: string) => {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
  });

  if (error) {
    throw error;
  }
};

/**
 * Sends the password-recovery email. No `redirectTo`: the email carries a
 * 6-digit code, redeemed through `verifyPasswordResetOtp`.
 *
 * `WithFallback` is historical here too; see the note above.
 */
export const sendPasswordResetEmailWithFallback = async (supabase: SupabaseClient, email: string) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email);

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
