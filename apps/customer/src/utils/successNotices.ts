/**
 * Success confirmations that outlive a navigation. A screen that finishes by
 * routing elsewhere passes `notice=<key>`; the destination renders the banner,
 * so the confirmation survives the transition without a blocking dialog.
 */
export const SUCCESS_NOTICES = {
  'account-created': {
    title: 'Check your email',
    // Shown on /verify-email, where the code field is, rather than on /login:
    // sign-up leaves no session, so telling someone to "sign in" at this point
    // sends them to a screen that cannot let them in until the code is used.
    message: 'We sent a 6-digit confirmation code. Enter it below to finish setting up your account.',
  },
  'email-verified': {
    title: 'Email confirmed',
    message: 'Your email is verified. Sign in to start ordering.',
  },
  'password-updated': {
    title: 'Password updated',
    message: 'You can now sign in with your new password.',
  },
  'reset-email-sent': {
    title: 'Reset code sent',
    message: 'Enter the 6-digit code from your inbox, then choose a new password.',
  },
} as const;

export type SuccessNoticeKey = keyof typeof SUCCESS_NOTICES;

export const isSuccessNoticeKey = (value: unknown): value is SuccessNoticeKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUCCESS_NOTICES, value);

/** Resolves a raw route param into a notice, ignoring anything unrecognised. */
export const resolveSuccessNotice = (value: unknown) => {
  const key = Array.isArray(value) ? value[0] : value;
  return isSuccessNoticeKey(key) ? SUCCESS_NOTICES[key] : null;
};
