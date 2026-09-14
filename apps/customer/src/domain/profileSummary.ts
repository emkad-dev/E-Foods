/**
 * Pure, Node-testable logic behind the customer Profile screen.
 *
 * The screen itself only arranges cards; every decision it makes — what letters
 * go in the avatar, whether the Orders tile reads a count or a live state, what
 * the delivery card says when no location has been chosen — lives here so it can
 * be asserted instead of eyeballed. In particular the empty-state copy is a
 * constant in this module rather than a string literal in JSX, because that copy
 * is the entire content of the delivery card for a brand-new account.
 */

// Reached through the package path with an explicit extension rather than via
// the local `./orders` shim: this module is executed directly by `node --test
// --experimental-strip-types`, where ESM resolution has no extension guessing,
// and the shim re-exports `packages/domain/src/orders` extensionlessly. Same
// convention the token package documents for its own Node-executed tests.
import {
  isTerminalOrderStatus,
  normalizeOrderStatus,
} from '../../../../packages/domain/src/orders.ts';

/**
 * Rendered when neither the display name nor the email yields a single cased
 * letter (an all-numeric address such as `08031234567@…`). Returning an empty
 * string instead would draw the avatar as a blank circle, which reads as a
 * failed image load rather than as "no name yet".
 */
export const PROFILE_INITIALS_FALLBACK = '?';

/** What the delivery card says before any location has been chosen. */
export const DELIVERY_SUMMARY_EMPTY_TITLE = 'Set your delivery area';

export type ProfileOrderLike = {
  status?: string | null;
};

export type ProfileDeliveryLocationLike = {
  address?: string | null;
  shortAddress?: string | null;
} | null;

export type ProfileOrderSummary = {
  /** Orders still moving — the number worth surfacing over a lifetime total. */
  activeCount: number;
  totalCount: number;
};

export type ProfileDeliverySummary = {
  title: string;
  /** `null` rather than an empty string so the screen can omit the line entirely. */
  subtitle: string | null;
};

/**
 * First cased letter in `word`, or `''`.
 *
 * `/\p{L}/u` would say this directly, but unicode property escapes are not safe
 * to assume across every Hermes build this app ships on, and `/[a-z]/i` would
 * drop accented Latin names. Comparing the two cases of a character is the
 * portable test that keeps `Ébun` working.
 */
const firstLetterOf = (word: string): string => {
  for (const char of word) {
    if (char.toLowerCase() !== char.toUpperCase()) {
      return char;
    }
  }

  return '';
};

/**
 * 1–2 uppercase letters for the identity-card avatar.
 *
 * Falls back to the email's local part because `displayName` is optional on
 * `UserDocument` and is genuinely unset for anyone who signed up with Google and
 * never opened Edit profile. Separators are split on rather than skipped so that
 * both `Ada Lovelace` and `ada.lovelace@…` produce `AL`, and a leading non-letter
 * (`_ada`) does not swallow the initial.
 */
export function getProfileInitials(
  displayName?: string | null,
  email?: string | null
): string {
  const name = (displayName ?? '').trim();
  const source = name || (email ?? '').trim().split('@')[0] || '';

  const initials = source
    .split(/[\s._+-]+/)
    .map(firstLetterOf)
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return initials || PROFILE_INITIALS_FALLBACK;
}

/**
 * Counts for the Orders tile.
 *
 * `draft` is excluded from `activeCount` deliberately. `normalizeOrderStatus`
 * maps anything it does not recognise — a null status, a status added by a newer
 * backend than this build — to `draft`, and `isTerminalOrderStatus('draft')` is
 * false, so trusting the terminal check alone would report unknown rows as
 * "in progress". A draft is a cart that was never placed; it is not something
 * the customer is waiting on.
 */
export function summarizeOrders(
  orders: readonly ProfileOrderLike[] | null | undefined
): ProfileOrderSummary {
  const list = Array.isArray(orders) ? orders : [];

  const activeCount = list.filter((order) => {
    const status = normalizeOrderStatus(order?.status);
    return status !== 'draft' && !isTerminalOrderStatus(status);
  }).length;

  return { activeCount, totalCount: list.length };
}

/**
 * The two lines of the delivery card.
 *
 * `shortAddress` is the neighbourhood-level label the location picker stores
 * alongside the full address; the `shortAddress ?? address` precedence matches
 * home, search and cart. The subtitle is dropped when it would merely repeat the
 * title, which is what happens whenever a location was saved without a short
 * form.
 */
export function formatDeliverySummary(
  location: ProfileDeliveryLocationLike
): ProfileDeliverySummary {
  const address = (location?.address ?? '').trim();
  const shortAddress = (location?.shortAddress ?? '').trim();

  if (!address && !shortAddress) {
    return { title: DELIVERY_SUMMARY_EMPTY_TITLE, subtitle: null };
  }

  const title = shortAddress || address;

  return { title, subtitle: address && address !== title ? address : null };
}
