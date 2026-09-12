/**
 * Success confirmations that outlive a navigation. A partner screen that
 * finishes by routing elsewhere passes `notice=<key>`; the destination renders
 * the live region, so the confirmation survives the transition without a
 * blocking dialog.
 *
 * This generalises the mechanism `reset-password.tsx` already used (it routed
 * to `/(auth)/login` with `notice=password-updated`, which login.tsx resolved
 * inline) so the other two flows that finished with nothing but an `Alert` —
 * inert on partner.feasty.com.ng — can finish the same way. Keyed rather than
 * free text so a typo at the call site is a type error instead of a route param
 * that silently renders nothing, which is the exact failure being fixed here.
 *
 * Mirrors `apps/customer/src/utils/successNotices.ts`.
 */
export const PARTNER_SUCCESS_NOTICES = {
  'account-created': 'Your partner login is ready. Sign in to complete your restaurant details and open your dashboard.',
  'account-created-unverified':
    'Your account was created, but the verification email could not be confirmed from the app. Try signing in, and use "Forgot password" if you need a fresh link.',
  'password-updated': 'Password updated. Sign in to open your dashboard.',
  'reset-link-sent':
    'If this partner account exists, a reset link is on its way. Open the link in your inbox to choose a new password.',
  'verification-email-sent':
    'We sent a verification email. Confirm it, then sign in to finish your restaurant setup and open your dashboard.',
} as const;

export type PartnerSuccessNoticeKey = keyof typeof PARTNER_SUCCESS_NOTICES;

export const isPartnerSuccessNoticeKey = (value: unknown): value is PartnerSuccessNoticeKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PARTNER_SUCCESS_NOTICES, value);

/** Resolves a raw route param into a message, ignoring anything unrecognised. */
export const resolvePartnerSuccessNotice = (value: unknown): string | null => {
  const key = Array.isArray(value) ? value[0] : value;
  return isPartnerSuccessNoticeKey(key) ? PARTNER_SUCCESS_NOTICES[key] : null;
};
