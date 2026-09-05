/**
 * Success confirmations that outlive a navigation. A screen that finishes by
 * routing elsewhere passes `notice=<key>`; the destination renders the banner,
 * so the confirmation survives the transition without a blocking dialog.
 */
export const SUCCESS_NOTICES = {
  'account-created': {
    title: 'Check your email',
    message: 'We sent a verification link. Confirm it, then sign in to start ordering.',
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
    title: 'Reset email sent',
    message: 'Open the link in your inbox to choose a new password.',
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
