// Task 16 (F2): the two availability predicates every consumer that decides
// whether a menu item or a restaurant can be ordered from MUST share.
//
// Auto-resume is TIME-BASED AT READ TIME, not a drainer sweep. An item/store
// marked unavailable with an `unavailableUntil`/`pausedUntil` timestamp is
// simply unavailable while `now <= until`, and available again the instant
// `now > until` — no write, no cron, no sweep flips a boolean back. This is
// raceless by construction: there is no "resume" transition to race, because
// nothing is ever compare-and-swapped back to available. Two concurrent
// readers a millisecond apart around the boundary just independently compute
// the same answer from the same wall clock read, which is the only
// "race" a pure function of `now` can have, and it is harmless: both readers
// see a consistent world, and the true wallclock crossing itself is the
// resume event, not any particular reader's observation of it. A boolean
// flag flipped by a sweep would instead need a compare-and-swap (like
// `ebuy_escalate_unaccepted_order`'s pattern) to avoid a stale write racing a
// partner's own manual re-enable — time-based avoids that class of race
// entirely by never writing on resume.
//
// `isAvailable=false` with no `unavailableUntil` (or an absent/past one) is
// the indefinite, MANUAL form: it stays off until the partner explicitly
// flips it back — no timestamp ever resurrects it on its own. Setting
// `unavailableUntil` to a future timestamp is the TIMED form: it auto-resumes
// the instant `now` passes that timestamp, independent of `isAvailable`.
//
// Every consumer that answers "can a customer order this right now" —
// the catalog card/list filter (public-catalog/catalog.ts's
// hasAvailableMenuItem), the deprecated customerGetPublishedRestaurants alias
// (relies on the client mirror in apps/customer/src/utils/
// restaurantAvailability.ts agreeing with the same rule), and
// placeCustomerOrder's server-side item/store rejection
// (_shared/domains/orders.ts) — imports these two functions rather than
// reimplementing the boolean/timestamp logic locally. A restaurant hidden
// from the list but orderable at checkout (or vice versa) is exactly the bug
// class this file exists to close off; see the drift test in
// public-catalog/catalog.test.ts that fails if the list filter and the
// placement check ever disagree on the same item.

export type MenuItemAvailabilityInput = {
  isAvailable?: unknown;
  unavailableUntil?: unknown;
};

export type StorePauseInput = {
  pausedUntil?: unknown;
};

/**
 * `until` must be a string that `Date.parse` accepts; anything else (absent,
 * not a string, unparsable) is treated as "no timed-unavailable window" so a
 * malformed value never accidentally hides an item/restaurant forever.
 */
const isFutureTimestamp = (value: unknown, now: Date): boolean => {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  const parsedMs = Date.parse(value);
  if (Number.isNaN(parsedMs)) {
    return false;
  }

  return parsedMs > now.getTime();
};

/**
 * True when a customer can order this menu item right now.
 *
 * Unavailable when EITHER:
 *   - `isAvailable === false` (the manual, indefinite off-switch — stays off
 *     until a partner flips it back, no matter what `unavailableUntil` says), OR
 *   - `unavailableUntil` is set to a timestamp still in the future (the timed
 *     form — auto-resumes the moment `now` passes it, with no write).
 *
 * A missing/non-boolean `isAvailable` defaults to available (matches the
 * pre-Task-16 `isAvailable !== false` convention throughout this codebase),
 * and a past/absent/malformed `unavailableUntil` never suppresses
 * availability on its own.
 */
export const isMenuItemAvailable = (
  item: MenuItemAvailabilityInput | null | undefined,
  now: Date = new Date()
): boolean => {
  if (!item) {
    return false;
  }

  if (item.isAvailable === false) {
    return false;
  }

  return !isFutureTimestamp(item.unavailableUntil, now);
};

/**
 * True when the restaurant itself is paused right now — `pausedUntil` is set
 * to a timestamp still in the future. Unset, past, or malformed `pausedUntil`
 * means not paused; there is no separate manual/indefinite pause form (Task
 * 16's `partnerSetStorePause` always requires an until when pausing).
 */
export const isStorePaused = (restaurant: StorePauseInput | null | undefined, now: Date = new Date()): boolean => {
  if (!restaurant) {
    return false;
  }

  return isFutureTimestamp(restaurant.pausedUntil, now);
};
