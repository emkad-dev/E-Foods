/**
 * The sidebar's "is there anything for me?" logic.
 *
 * Eleven nav links rendered identically whether or not work was waiting on
 * them, so an admin had to open Approvals and Inbox to find out. Two of those
 * eleven are queues where a human must act; this module decides what those
 * two links say.
 *
 * The rules that matter are all at the boundaries, which is why they live
 * here rather than inline in AppLayout:
 *
 *   - "we could not ask" is null, and must never render as a zero. A `0`
 *     badge is a claim that the queue is clear, and a failed read has no
 *     standing to make it -- the same defect resolveViewState() exists to
 *     stop the dashboards making about orders and revenue.
 *   - "there is nothing waiting" renders nothing at all. A 0 on every link
 *     all day is noise, and noise on ten links is how the two that matter
 *     stop being noticed.
 *   - the badge may not grow the sidebar. The nav is a fixed column, so a
 *     four-digit count would either wrap the label or push it out of the
 *     box; counts above the cap collapse to `99+`.
 */

/** Above this the badge shows `99+` rather than a number that widens the nav. */
export const NAV_COUNT_CAP = 99;

/** A count we have, or `null`/`undefined` for "no answer yet / the read failed". */
export type NavCount = number | null | undefined;

/** The two queues where a human must act. Nothing else gets a badge. */
export type NavCountKey = 'approvals' | 'inbox';

export type NavCounts = Record<NavCountKey, number | null>;

/**
 * The text inside the badge, or `null` for "render no badge".
 *
 * Non-integers and negatives are not expected from either read, but a count
 * is arithmetic over a server payload -- `NaN` from a malformed response must
 * degrade to no badge, not to a badge reading "NaN".
 */
export function formatNavCount(count: NavCount, cap: number = NAV_COUNT_CAP): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return null;
  }

  const whole = Math.floor(count);

  if (whole <= 0) {
    return null;
  }

  return whole > cap ? `${cap}+` : String(whole);
}

/**
 * The link's accessible name, or `undefined` to leave the link's own text as
 * its name.
 *
 * The badge is `aria-hidden` and this is why: left visible it is a second,
 * unlabelled text node inside the link, so a screen reader announces
 * "Approvals 3" -- a number with no unit and no stated relationship to the
 * word before it. One name carrying both ("Approvals, 3 waiting") is the
 * whole point, and it also means the information is not being carried by a
 * coloured pill alone.
 */
export function describeNavCount(
  label: string,
  count: NavCount,
  cap: number = NAV_COUNT_CAP
): string | undefined {
  if (formatNavCount(count, cap) === null) {
    return undefined;
  }

  const whole = Math.floor(count as number);

  // "99+ waiting" is a glyph, not a phrase; say the comparison out loud.
  return whole > cap ? `${label}, more than ${cap} waiting` : `${label}, ${whole} waiting`;
}

/**
 * Pending partner + dispatch applications, or `null` when the queue never
 * arrived.
 *
 * The queue read returns every application regardless of status and
 * ApprovalsPage filters to `pending` before rendering either list, so
 * counting rows would badge Approvals with historical decisions that need
 * nobody. `restaurants` is deliberately excluded: that third list on the page
 * is a publish toggle over already-approved restaurants, not a queue that
 * drains.
 *
 * A `null`/`undefined` argument is "the read failed or has not landed" and
 * propagates as null. It is explicitly NOT zero.
 */
export function countPendingApplications(
  queue:
    | {
        dispatchApplications?: ReadonlyArray<{ status?: string | null }> | null;
        partnerApplications?: ReadonlyArray<{ status?: string | null }> | null;
      }
    | null
    | undefined
): number | null {
  if (queue === null || queue === undefined) {
    return null;
  }

  const pending = (rows: ReadonlyArray<{ status?: string | null }> | null | undefined) =>
    (rows ?? []).filter((row) => row.status === 'pending').length;

  return pending(queue.partnerApplications) + pending(queue.dispatchApplications);
}

/**
 * Open conversations, or `null` when the inbox never arrived.
 *
 * The provider asks the server for `status: 'open'` -- the same default
 * InboxPage opens on -- so this is a length, but it re-checks the status
 * rather than trusting the filter it asked for: if that request is ever
 * widened the badge must not start counting closed threads as work.
 */
export function countOpenConversations(
  conversations: ReadonlyArray<{ status?: string | null }> | null | undefined
): number | null {
  if (conversations === null || conversations === undefined) {
    return null;
  }

  return conversations.filter((conversation) => conversation.status === 'open').length;
}
