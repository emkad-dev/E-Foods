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
 * The one message every app shows when a sign-up hits an address that already
 * has an account. Exported so the register screens can recognise it by identity
 * and offer the two follow-up routes (sign in / enter your code) beside it,
 * rather than string-matching prose.
 *
 * WHY THE WORDING HEDGES. With email confirmation on, Supabase answers a repeat
 * sign-up identically in two materially different cases:
 *   - the address belongs to a CONFIRMED user  -> nothing is sent;
 *   - the address belongs to an UNCONFIRMED user -> the confirmation email is
 *     RESENT.
 * Both come back HTTP 200 with an empty `identities` array, and the client has
 * no way to tell them apart. So the message must be true either way: it states
 * the one certain fact (the address is registered), points at sign-in, and puts
 * the inbox suggestion behind an explicit "if you never confirmed it" — which is
 * exactly the branch where an email really was just sent. Do not tighten this
 * into "we've sent you a code": that would be a lie to the confirmed half.
 *
 * DELIBERATE USER ENUMERATION — an owner decision, not an oversight. Supabase's
 * silent 200 exists precisely so nobody can probe which addresses are
 * registered, and saying this out loud gives that up. The owner weighed it and
 * chose the UX, as most consumer apps do: the silent version cost a real signup,
 * which looked like a dead email pipeline until the auth log showed
 * `user_repeated_signup`. Do not revert it to silence without asking.
 */
export const ACCOUNT_ALREADY_REGISTERED_MESSAGE =
  'This email is already registered. Sign in instead — or if you never confirmed it, check your inbox for a new code.';

/**
 * True only when Supabase positively said "this address already has an
 * account": `identities` present, an array, and empty.
 *
 * The `Array.isArray` guard is the point. A client build that omits `identities`
 * altogether must read as "unknown" and fall through to the normal success path
 * — a false positive here would tell every genuinely new user that their brand
 * new address was already taken, which is a far worse failure than the one this
 * whole branch exists to fix.
 */
const isAlreadyRegisteredSignUpUser = (user: User): boolean =>
  Array.isArray((user as { identities?: unknown }).identities) &&
  (user as { identities: unknown[] }).identities.length === 0;

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
 *
 * `alreadyRegistered` carries the empty-`identities` signal out to the caller.
 * It used to be thrown away here, which is why a repeat sign-up looked like a
 * success to every screen in the repo. See
 * `ACCOUNT_ALREADY_REGISTERED_MESSAGE` above for what it means and the
 * enumeration trade-off it implies.
 */
export const createUserWithEmail = async (
  supabase: SupabaseClient,
  email: string,
  password: string,
  metadata?: Record<string, unknown>
): Promise<{ user: User; session: Session | null; alreadyRegistered: boolean }> => {
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
    alreadyRegistered: isAlreadyRegisteredSignUpUser(data.user),
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
    // Same text as the empty-`identities` path above, so a project configured
    // to return the error outright lands the user on the same message — and the
    // register screens' identity check offers the same two routes either way.
    user_already_exists: ACCOUNT_ALREADY_REGISTERED_MESSAGE,
    email_exists: ACCOUNT_ALREADY_REGISTERED_MESSAGE,
    weak_password: 'Password must be at least 6 characters',
    validation_failed: 'Please enter a valid email address',
    unexpected_failure: 'Network error. Check your internet connection and try again',
  };

  return errorMap[errorCode] || errorMessage;
};
