/**
 * Client-side validation for the partner auth screens, as plain functions that
 * return the message to render — or `null` when the form may be submitted.
 *
 * WHY THIS EXISTS: every one of these checks used to `Alert.alert` and return.
 * `Alert` is `class Alert { static alert() {} }` in `react-native-web`, so on
 * partner.feasty.com.ng submitting an empty sign-in, an incomplete registration
 * or a mismatched password pair did nothing observable whatsoever — the button
 * simply appeared broken. Each of those screens already renders an inline error
 * (`AuthContext`'s `error`, or reset-password's own local `error`), but
 * client-side validation never reaches `AuthContext`, so the slot stayed empty.
 * Routing these messages into that same slot means there is exactly one error
 * surface per screen rather than a second competing one.
 *
 * Ported from `apps/customer/src/domain/authFormValidation.ts`; the copy is
 * deliberate — the partner wording names the partner account and the partner
 * dashboard, and the two apps' forms do not carry the same fields.
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
    return 'Enter both your partner email and your password to continue.';
  }

  return null;
}

export function validateForgotPasswordForm({ email }: { email: string }): string | null {
  if (!email.trim()) {
    return 'Enter the email address linked to your partner account.';
  }

  return null;
}

export type RegisterFormInput = {
  contactName: string;
  email: string;
  password: string;
  /** The E.164 number `PhoneInput` produces, or null while it is incomplete. */
  phoneE164: string | null;
  acceptedPolicies: boolean;
};

export function validateRegisterForm({
  contactName,
  email,
  password,
  phoneE164,
  acceptedPolicies,
}: RegisterFormInput): string | null {
  if (!contactName.trim() || !email.trim() || !password.trim() || !phoneE164?.trim()) {
    return 'Complete the contact name, email, password, and phone number before continuing.';
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return PASSWORD_TOO_SHORT;
  }

  if (!acceptedPolicies) {
    return 'Accept the Terms and Privacy Policy before creating your login.';
  }

  return null;
}

export type ResetPasswordFormInput = {
  /** True when the link carried a recovery code, or both session tokens. */
  hasResetCredential: boolean;
  password: string;
  confirmPassword: string;
};

export function validateResetPasswordForm({
  hasResetCredential,
  password,
  confirmPassword,
}: ResetPasswordFormInput): string | null {
  // Checked first: no password the partner types can rescue a link with no code
  // in it, so telling them about the link is the only useful message.
  if (!hasResetCredential) {
    return 'This reset link is missing the required recovery code. Request a new reset email and open the newest link.';
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
