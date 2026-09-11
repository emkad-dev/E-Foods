/**
 * In-app account deletion: the copy shown in the confirm dialog, and the
 * formatting of a refusal coming back from the server.
 *
 * Apple Guideline 5.1.1(v) and Google Play both require an account-deletion
 * control the user can reach from inside the app, so this wording is
 * compliance-relevant and is deliberately identical on customer, partner and
 * dispatch. It lives here, in the pure-logic package all three apps already
 * import, so the three screens cannot drift apart: they render
 * `accountDeletionParagraphs(...)`, they do not hold their own strings.
 *
 * Nothing in this module imports React or `react-native`, which is what keeps it
 * testable under `node --test`.
 */

import type { PolicyApp } from './policies';

/** Customer / partner / dispatch — the same three surfaces the policy copy uses. */
export type AccountDeletionSurface = PolicyApp;

export const ACCOUNT_DELETION_TITLE = 'Delete account';
export const ACCOUNT_DELETION_CONFIRM_LABEL = 'Delete account';
export const ACCOUNT_DELETION_CANCEL_LABEL = 'Cancel';

/** Shown on every surface, in this order. */
const SHARED_PARAGRAPHS = [
  'This permanently deletes your FEASTY sign-in and profile. It cannot be undone.',
  'Deleted straight away: your sign-in, name, email, phone, saved addresses, favourites and role access.',
  'Kept: past order records, which we must retain for tax, accounting and dispute resolution. They are no longer linked to a sign-in account.',
] as const;

/**
 * The surface-specific tail. These exist because the server legitimately refuses
 * deletion for these two roles (412), so the dialog warns before the request
 * rather than after it.
 */
const SURFACE_PARAGRAPHS: Record<AccountDeletionSurface, readonly string[]> = {
  customer: [],
  partner: [
    'If your account is linked to a restaurant, support must offboard it first so store ownership and order history stay traceable.',
  ],
  dispatch: [
    'If you have an active delivery, support must offboard your account after those assignments are cleared.',
  ],
};

/** The dialog body, as paragraphs, for one surface. */
export const accountDeletionParagraphs = (surface: AccountDeletionSurface): readonly string[] => [
  ...SHARED_PARAGRAPHS,
  ...SURFACE_PARAGRAPHS[surface],
];

/** The same body as a single blank-line-separated string, for non-React callers. */
export const accountDeletionBody = (surface: AccountDeletionSurface): string =>
  accountDeletionParagraphs(surface).join('\n\n');

export const ACCOUNT_DELETION_FALLBACK_MESSAGE = 'Unable to delete this account right now.';

/**
 * Turn whatever `deleteAccount()` rejected with into a string safe to render in
 * the screen's inline error slot.
 *
 * The auth contexts reject with a real `Error` whose message is the server's
 * (already client-safe) refusal — the 412 "Partner accounts linked to a
 * restaurant must be offboarded by admin" and 409 texts are what the user needs
 * to read, so they are passed through verbatim. Anything shapeless, empty, or
 * not a string collapses to the fallback rather than rendering "[object Object]"
 * or an empty error row.
 */
export const accountDeletionErrorMessage = (
  error: unknown,
  fallback: string = ACCOUNT_DELETION_FALLBACK_MESSAGE
): string => {
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? (error as { message?: unknown }).message
        : undefined;

  if (typeof raw !== 'string') {
    return fallback;
  }

  const trimmed = raw.trim();

  return trimmed.length > 0 ? trimmed : fallback;
};
