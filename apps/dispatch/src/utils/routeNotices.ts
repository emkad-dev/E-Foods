/**
 * Messages that have to outlive a navigation. A dispatch screen that finishes
 * by routing elsewhere passes `notice=<key>`; the destination renders the live
 * region, so the message survives the transition without a blocking dialog.
 *
 * This generalises the mechanism `reset-password.tsx` already used — it routed
 * to `/(auth)/login` with `notice=password-updated`, which `login.tsx` resolved
 * with a hand-written string comparison — so the other flows that finished with
 * nothing but an `Alert` can finish the same way. Keyed rather than free text
 * for two reasons: a typo at the call site becomes a type error instead of a
 * route param that silently renders nothing (the exact failure class being
 * fixed here), and no server-supplied string is ever put into a URL.
 *
 * Mirrors `apps/partner/src/utils/successNotices.ts`, with one addition: the
 * offer screen's refusal is a FAILURE that still has to cross a navigation, so
 * the outcome notices carry a tone and the destination styles them accordingly.
 */

export const DISPATCH_SUCCESS_NOTICES = {
  'login-ready': 'Your rider login is ready. Complete your rider details below to finish setup.',
  'password-updated': 'Password updated. Sign in with your new password.',
  'reset-link-sent':
    'If this dispatch account exists, a reset link is on its way. Open the link in your inbox to choose a new password.',
  'verification-email-sent':
    'We sent a verification email. Confirm it, then sign in to finish your rider setup.',
  'verification-email-failed':
    'Your login was created, but the verification email could not be sent from the app. Sign in after you verify your email.',
} as const;

export type DispatchSuccessNoticeKey = keyof typeof DISPATCH_SUCCESS_NOTICES;

export const isDispatchSuccessNoticeKey = (value: unknown): value is DispatchSuccessNoticeKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(DISPATCH_SUCCESS_NOTICES, value);

/** Resolves a raw route param into a message, ignoring anything unrecognised. */
export const resolveDispatchSuccessNotice = (value: unknown): string | null => {
  const key = Array.isArray(value) ? value[0] : value;
  return isDispatchSuccessNoticeKey(key) ? DISPATCH_SUCCESS_NOTICES[key] : null;
};

/**
 * The offer screen answers accept/decline and then routes to `/deliveries`
 * either way, so its refusal cannot be shown where it happened — the screen is
 * already unmounted. The rider's next move is identical for every refusal the
 * backend can return (the offer is gone; wait for the next one), so a fixed
 * message per action carries everything the specific server string did.
 */
export const DISPATCH_OFFER_NOTICES = {
  'offer-accept-failed':
    'That offer is no longer yours to accept — another rider took it, or the 45-second window closed. The queue below is up to date.',
  'offer-decline-failed':
    'That offer could not be declined because it is no longer active. The queue below is up to date.',
} as const;

export type DispatchOfferNoticeKey = keyof typeof DISPATCH_OFFER_NOTICES;

export const isDispatchOfferNoticeKey = (value: unknown): value is DispatchOfferNoticeKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(DISPATCH_OFFER_NOTICES, value);

/** Resolves a raw route param into a message, ignoring anything unrecognised. */
export const resolveDispatchOfferNotice = (value: unknown): string | null => {
  const key = Array.isArray(value) ? value[0] : value;
  return isDispatchOfferNoticeKey(key) ? DISPATCH_OFFER_NOTICES[key] : null;
};
