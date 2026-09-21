import { useEffect, useState } from 'react';

/**
 * "Has anything changed since I last looked?"
 *
 * Every page in this console renders current state and nothing else, so each
 * visit starts with that question and the only way to answer it is to re-read
 * the whole screen. On the two queues where the answer changes what someone
 * does -- approvals and the support inbox -- this module remembers when the
 * admin last left the page and lets the page mark the rows that arrived since.
 *
 * The scope is deliberately small and deliberately local: per page, per
 * browser, in `localStorage`. It is a reading aid for one operator at one
 * desk, NOT a record of who reviewed what. Nothing server-side reads it,
 * nothing is claimed about it, and a browser that loses it loses only the
 * markers. That is why the storage failures below are all swallowed: the value
 * is never worth a broken page.
 *
 * SHAPE: the decision is pure and the storage sits at the edges, so the rule
 * ("is this row newer than the previous visit?") is testable without a DOM and
 * without a fake `window`. See lastVisit.test.ts.
 */

/**
 * The pages that keep a visit marker. A union rather than a free string so a
 * typo cannot silently give a page its own private, never-read key -- the
 * failure mode of this feature is invisible (no marker ever appears), which is
 * exactly the kind that survives review.
 */
export type LastVisitPage = 'approvals' | 'inbox';

/**
 * Namespaced because `localStorage` is shared per origin, and the admin
 * console shares its origin with nothing else only by accident of deployment.
 */
export const LAST_VISIT_KEY_PREFIX = 'feasty.admin.lastVisit.';

export const lastVisitKey = (page: LastVisitPage): string => `${LAST_VISIT_KEY_PREFIX}${page}`;

/** The narrowest slice of the Storage API this module touches, so tests can pass a plain object. */
export interface LastVisitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Milliseconds since the epoch for a row's timestamp, or null when the value
 * cannot be trusted.
 *
 * The direction of failure is the whole point. An unparseable timestamp must
 * resolve to "not new", never to "new": row timestamps arrive from the server
 * and a schema change, a null column or a malformed date would otherwise light
 * up EVERY row at once. A marker that fires on a data glitch is a marker
 * people learn to ignore, and then it is worth nothing on the day it is right.
 */
export function parseRowTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === 'number') {
    // Rejects NaN and Infinity. 0 and negatives are pre-1970 and, for rows in
    // this console, mean "the field was empty and something coerced it".
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (trimmed === '') {
      return null;
    }

    const time = new Date(trimmed).getTime();
    return Number.isFinite(time) ? time : null;
  }

  // null, undefined, objects, booleans.
  return null;
}

/**
 * The one decision this module exists to make.
 *
 * FIRST VISIT (`previousVisit === null`) marks nothing. There is no baseline,
 * so the only alternatives are to mark every row -- which is noise on a queue
 * of any size, and trains the operator to ignore the marker before they have
 * ever seen it mean something -- or to mark none and let the first visit
 * establish the baseline for the second. The marker's whole value is that it
 * is rare, so the first visit spends none of it. A browser with storage
 * blocked reads as a permanent first visit and therefore never marks, which is
 * the same conservative answer for the same reason.
 *
 * Both clocks matter and only one is ours: `previousVisit` comes from the
 * operator's machine and the row timestamps come from the server. A client
 * clock running behind makes a few already-seen rows look new; running ahead
 * hides a few genuinely new ones. Neither is worth correcting for a reading
 * aid, and no correction a client can make would be more trustworthy than the
 * skew it is compensating for.
 */
export function isNewSince(previousVisit: number | null, rowTimestamp: unknown): boolean {
  if (previousVisit === null) {
    return false;
  }

  const at = parseRowTimestamp(rowTimestamp);

  if (at === null) {
    return false;
  }

  return at > previousVisit;
}

/** How many of these rows arrived since the previous visit. Same rule, counted. */
export function countNewSince(previousVisit: number | null, rowTimestamps: readonly unknown[]): number {
  if (previousVisit === null) {
    return 0;
  }

  return rowTimestamps.reduce<number>(
    (total, timestamp) => (isNewSince(previousVisit, timestamp) ? total + 1 : total),
    0
  );
}

/**
 * `window.localStorage` is not a property you can safely read: in a private
 * window, and with site data blocked, the GETTER ITSELF throws before you ever
 * reach `getItem`. Hence the try/catch around the access and not just the call.
 */
function resolveStorage(storage: LastVisitStorage | null | undefined): LastVisitStorage | null {
  if (storage !== undefined) {
    return storage;
  }

  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The previous visit's timestamp, or null when there isn't a usable one.
 *
 * Every non-answer collapses to null -- no storage, no key, a value written by
 * an older build, a value some other tool clobbered -- because null is the
 * first-visit case and the first-visit case marks nothing. Corrupt storage
 * must not be read as `0`, which would be a baseline at the epoch and would
 * mark every row on the page as new.
 */
export function readLastVisit(page: LastVisitPage, storage?: LastVisitStorage | null): number | null {
  const store = resolveStorage(storage);

  if (store === null) {
    return null;
  }

  let raw: string | null;

  try {
    raw = store.getItem(lastVisitKey(page));
  } catch {
    return null;
  }

  if (raw === null || raw.trim() === '') {
    return null;
  }

  // `Number` rather than `parseInt`: parseInt('2026-09-21') is 2026, so a
  // stored ISO string -- an entirely plausible thing for a future version of
  // this code to write -- would parse as a baseline 2000 years before the
  // epoch and mark everything. Number() rejects it outright.
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Records that the page has now been seen. Swallows everything: a full quota,
 * a blocked origin and a private window all mean "no markers next time", which
 * is a degradation, not a failure.
 */
export function writeLastVisit(
  page: LastVisitPage,
  at: number = Date.now(),
  storage?: LastVisitStorage | null
): void {
  const store = resolveStorage(storage);

  if (store === null || !Number.isFinite(at) || at <= 0) {
    return;
  }

  try {
    store.setItem(lastVisitKey(page), String(Math.trunc(at)));
  } catch {
    // Intentionally silent -- see the module comment.
  }
}

/**
 * Reads the previous visit, then arranges for this visit to become the next
 * one's baseline. Returns the PREVIOUS value, stable for the life of the
 * mount, so every row on the page is judged against one fixed instant.
 *
 * ORDER IS THE WHOLE TRICK. The read happens in the `useState` initialiser,
 * during render; the write happens in an effect's cleanup, on the way out.
 * Writing first -- the obvious "mark this page as seen when you open it" --
 * makes the comparison always empty, because the baseline would then be
 * "now" and nothing is newer than now. Nothing in this hook writes on the way
 * in.
 *
 * `pagehide` covers the way out React cannot see: closing the tab or the
 * window runs no cleanup, so without it a session that ends on this page
 * never records the visit at all. It is not `visibilitychange`: switching
 * away to another tab and back is not leaving, and re-baselining on it would
 * quietly erase markers the operator has not read yet.
 *
 * Under StrictMode the effect mounts, cleans up and remounts, so the value is
 * written once on that first cleanup. The returned baseline survives it --
 * StrictMode preserves state across the remount -- so the markers on screen
 * are computed against the real previous visit, not against that write.
 */
export function useLastVisit(page: LastVisitPage): number | null {
  // Lazy initialiser: runs exactly once, on the first render, before any
  // effect. A bare `readLastVisit(page)` here would re-read on every render
  // and start returning this visit's own write.
  const [previousVisit] = useState<number | null>(() => readLastVisit(page));

  useEffect(() => {
    const markVisited = () => writeLastVisit(page);

    window.addEventListener('pagehide', markVisited);

    return () => {
      window.removeEventListener('pagehide', markVisited);
      markVisited();
    };
  }, [page]);

  return previousVisit;
}
