/**
 * Client-side validation for the dispatch auth screens, as plain functions that
 * return the message to render — or `null` when the form may be submitted.
 *
 * WHY THIS EXISTS: every one of these checks used to `Alert.alert` and return.
 * `Alert` is `class Alert { static alert() {} }` in `react-native-web`, so the
 * day dispatch gains a web build (it has a `web` dev script but no `build:web`
 * and no workflow, so this is armed rather than firing) submitting an empty
 * sign-in, an incomplete registration or a mismatched password pair would do
 * nothing observable whatsoever — the button would simply appear broken. Each
 * of these screens already renders an inline error (`AuthContext`'s `error`, or
 * reset-password's own local `error`), but client-side validation never reaches
 * `AuthContext`, so the slot stayed empty.
 *
 * Ported from `apps/partner/src/domain/authFormValidation.ts`; the copy is
 * deliberate — the dispatch wording names the rider login and the dispatch
 * board, and the three apps' forms do not carry the same fields.
 */

/** Matches the minimum Supabase Auth is configured to accept. */
export const MIN_PASSWORD_LENGTH = 6;

const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;

export type LoginFormInput = {
  email: string;
  password: string;
};

export function validateLoginForm({ email, password }: LoginFormInput): string | null {
  if (!email.trim() || !password.trim()) {
    return 'Enter both your dispatch email and your password to continue.';
  }

  return null;
}

export function validateForgotPasswordForm({ email }: { email: string }): string | null {
  if (!email.trim()) {
    return 'Enter the email address linked to your dispatch account.';
  }

  return null;
}

export type RegisterFormInput = {
  displayName: string;
  email: string;
  password: string;
  /** The E.164 number `PhoneInput` produces, or null while it is incomplete. */
  phoneE164: string | null;
  acceptedPolicies: boolean;
};

export function validateRegisterForm({
  displayName,
  email,
  password,
  phoneE164,
  acceptedPolicies,
}: RegisterFormInput): string | null {
  if (!displayName.trim() || !email.trim() || !password.trim() || !phoneE164?.trim()) {
    return 'Complete your name, email, password, and phone number before continuing.';
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return PASSWORD_TOO_SHORT;
  }

  if (!acceptedPolicies) {
    return 'Accept the Terms and Privacy Policy before creating your rider login.';
  }

  return null;
}

export type EmailCodeInput = { value: string };

/** The 6-digit code length used by both email confirmation and password reset. */
export const EMAIL_CODE_LENGTH = 6;

export function validateEmailCode({ value }: EmailCodeInput): string | null {
  if (value.trim().length < EMAIL_CODE_LENGTH) {
    return `The code in your email is ${EMAIL_CODE_LENGTH} digits. Enter all ${EMAIL_CODE_LENGTH}.`;
  }

  return null;
}

export type VerifyEmailFormInput = {
  /**
   * The address the confirmation code was sent to. Carried from register as a
   * route param, or typed on the screen when the rider landed there directly.
   */
  email: string;
  /** The 6-digit confirmation code from the email. */
  code: string;
};

/**
 * Email confirmation is OTP-only, and this screen runs signed out, so
 * `verifyOtp` needs the address as well as the code — a code alone identifies
 * nobody.
 */
export function validateVerifyEmailForm({ email, code }: VerifyEmailFormInput): string | null {
  if (!email.trim()) {
    return 'Enter the email address you signed up with.';
  }

  return validateEmailCode({ value: code });
}

export type ResetPasswordFormInput = {
  /**
   * The address the recovery code was sent to. Carried from forgot-password as
   * a route param, or typed on the screen when the rider landed there directly.
   */
  email: string;
  /** The 6-digit recovery code from the email. */
  code: string;
  password: string;
  confirmPassword: string;
};

/**
 * Password reset is OTP-only: there is no link, so the screen needs the address
 * AND the code before any password it is given means anything. Both are checked
 * before the password pair, in the order the fields are rendered.
 */
export function validateResetPasswordForm({
  email,
  code,
  password,
  confirmPassword,
}: ResetPasswordFormInput): string | null {
  // `verifyOtp` is keyed on (email, token) — a code alone identifies nobody, so
  // a missing address is the first thing worth telling the rider about.
  if (!email.trim()) {
    return 'Enter the email address you asked for the reset code with.';
  }

  const codeError = validateEmailCode({ value: code });
  if (codeError) {
    return codeError;
  }

  if (!password.trim() || !confirmPassword.trim()) {
    return 'Please enter both password fields to continue.';
  }

  if (password !== confirmPassword) {
    return 'Your passwords must match.';
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return PASSWORD_TOO_SHORT;
  }

  return null;
}
