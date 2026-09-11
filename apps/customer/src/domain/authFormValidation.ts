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
  // Checked first: no password the user types can rescue a link with no code in
  // it, so telling them about the link is the only useful message.
  if (!hasResetCredential) {
    return 'This reset link is missing the required reset code. Request a new reset email and open the newest link.';
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

export type ProfileFieldInput = { value: string };

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

/** Verify email > the 6-digit code field. */
export const EMAIL_CODE_LENGTH = 6;

export function validateEmailCode({ value }: ProfileFieldInput): string | null {
  if (value.trim().length < EMAIL_CODE_LENGTH) {
    return `The code in your email is ${EMAIL_CODE_LENGTH} digits. Enter all ${EMAIL_CODE_LENGTH}.`;
  }

  return null;
}
