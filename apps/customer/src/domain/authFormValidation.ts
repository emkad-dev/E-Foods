/**
 * Client-side validation for the customer auth screens, as plain functions that
 * return the message to render — or `null` when the form may be submitted.
 *
 * WHY THIS EXISTS: every one of these checks used to `Alert.alert` and return.
 * `Alert` is a no-op in `react-native-web`, so on app.feasty.com.ng submitting
 * an incomplete registration, a mismatched password pair or an unticked terms
 * box did nothing observable whatsoever — the button simply appeared broken.
 * Each of those screens already renders `AuthContext`'s `error` inline, but
 * client-side validation never reaches `AuthContext`, so the slot stayed empty.
 * Routing these messages into that same slot means there is exactly one error
 * surface per screen rather than a second competing one.
 */

/** Matches the minimum Supabase Auth is configured to accept. */
export const MIN_PASSWORD_LENGTH = 6;

const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
const PASSWORD_MISMATCH = 'Your passwords must match.';

export type LoginFormInput = {
  email: string;
  password: string;
};

export function validateLoginForm({ email, password }: LoginFormInput): string | null {
  if (!email.trim() || !password.trim()) {
    return 'Please enter both your email and your password.';
  }

  return null;
}

export function validateForgotPasswordForm({ email }: { email: string }): string | null {
  if (!email.trim()) {
    return 'Enter the email address linked to your account.';
  }

  return null;
}

/**
 * Email domains the CUSTOMER app accepts at sign-up.
 *
 * The aliases are on the list on purpose, not by accident: `googlemail.com` is
 * Gmail under its other name, `me.com` and `mac.com` are the older Apple
 * addresses iCloud still delivers to, and `yahoo.com.ng` is in everyday use in
 * Nigeria. Dropping any of them rejects people who own an account at exactly one
 * of the three providers this list is meant to allow.
 *
 * CUSTOMER ONLY. The partner and dispatch apps deliberately do NOT have this
 * check: partner sign-ups are restaurant owners who routinely use a business
 * domain or Outlook, and gating them here would reject legitimate partners at
 * onboarding. Each app owns its own `authFormValidation`, so there is nothing
 * shared to accidentally inherit — keep it that way.
 */
export const ALLOWED_SIGNUP_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.com.ng',
  'icloud.com',
  'me.com',
  'mac.com',
];

const SIGNUP_EMAIL_INCOMPLETE = 'Enter a complete email address, like yourname@gmail.com.';

/**
 * Names what IS accepted rather than only refusing. A bare "invalid email" on an
 * address that is obviously well formed reads as a bug in the app, and the user
 * retypes the same thing.
 */
const SIGNUP_EMAIL_DOMAIN_REJECTED = `Sign up with a Gmail, Yahoo or iCloud address. We accept ${ALLOWED_SIGNUP_EMAIL_DOMAINS.join(
  ', '
)}.`;

/**
 * SIGN-UP ONLY — and it must stay that way.
 *
 * `validateRegisterForm` below is the sole caller. This check deliberately does
 * NOT run on sign-in, password reset, reset-code entry or email confirmation:
 * customer accounts created before this list existed may sit on a domain that is
 * not on it, and applying the same check to any of those paths would lock those
 * people out of an account they already own — a far worse outcome than letting
 * an unusual domain register. "We validate emails" is exactly the kind of rule
 * someone later applies everywhere; do not.
 *
 * Pure and case/whitespace-insensitive: the whole address is trimmed and
 * lowercased before the domain is compared.
 */
export function validateSignupEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split('@');

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return SIGNUP_EMAIL_INCOMPLETE;
  }

  // Whole-domain equality, never `endsWith`/`includes`. `endsWith('gmail.com')`
  // would accept `not-gmail.com`, and a contains test would accept
  // `gmail.com.evil.com` — both are attacker-chosen domains that merely spell an
  // allowed one somewhere inside them.
  if (!ALLOWED_SIGNUP_EMAIL_DOMAINS.includes(parts[1])) {
    return SIGNUP_EMAIL_DOMAIN_REJECTED;
  }

  return null;
}

export type RegisterFormInput = {
  nickname: string;
  email: string;
  password: string;
  confirmPassword: string;
  phoneNumber: string;
  acceptedPolicies: boolean;
};

export function validateRegisterForm({
  nickname,
  email,
  password,
  confirmPassword,
  phoneNumber,
  acceptedPolicies,
}: RegisterFormInput): string | null {
  if (!nickname.trim() || !email.trim() || !password.trim() || !phoneNumber.trim()) {
    return 'Please complete all fields before continuing.';
  }

  // Registration is the ONLY place the domain allowlist runs — see the note on
  // `validateSignupEmailDomain`. Checked in field order, so the message points at
  // the email box the user is looking at rather than jumping to the passwords.
  const emailDomainError = validateSignupEmailDomain(email);
  if (emailDomainError) {
    return emailDomainError;
  }

  if (password !== confirmPassword) {
    return PASSWORD_MISMATCH;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return PASSWORD_TOO_SHORT;
  }

  if (!acceptedPolicies) {
    return 'Accept the Terms and Privacy Policy before creating an account.';
  }

  return null;
}

export type ProfileFieldInput = { value: string };

/** The 6-digit code length used by both email confirmation and password reset. */
export const EMAIL_CODE_LENGTH = 6;

export function validateEmailCode({ value }: ProfileFieldInput): string | null {
  if (value.trim().length < EMAIL_CODE_LENGTH) {
    return `The code in your email is ${EMAIL_CODE_LENGTH} digits. Enter all ${EMAIL_CODE_LENGTH}.`;
  }

  return null;
}

export type ResetPasswordFormInput = {
  /**
   * The address the recovery code was sent to. Carried from forgot-password as
   * a route param, or typed on the screen when the user landed there directly.
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
  // a missing address is the first thing worth telling the user about.
  if (!email.trim()) {
    return 'Enter the email address you asked for the reset code with.';
  }

  const codeError = validateEmailCode({ value: code });
  if (codeError) {
    return codeError;
  }

  if (!password.trim() || !confirmPassword.trim()) {
    return 'Please enter both passwords to continue.';
  }

  if (password !== confirmPassword) {
    return PASSWORD_MISMATCH;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return PASSWORD_TOO_SHORT;
  }

  return null;
}

/** Profile > Username. Empty is the only rejection; the server owns the rest. */
export function validateUsername({ value }: ProfileFieldInput): string | null {
  if (!value.trim()) {
    return 'Add the name you want the app to greet you with.';
  }

  return null;
}

/** Profile > Phone number — the number riders and support actually dial. */
export function validatePhoneNumber({ value }: ProfileFieldInput): string | null {
  if (!value.trim()) {
    return 'Add the phone number you want riders and support to use.';
  }

  return null;
}
