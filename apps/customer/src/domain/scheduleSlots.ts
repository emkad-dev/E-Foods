/**
 * Checkout slot generation for scheduled orders (Task 30 [H6]).
 *
 * THE CONTRACT. This is a deliberate client-side MIRROR of the server's
 * validateScheduledSlot (supabase/functions/_shared/scheduledOrders.ts). The
 * server stays the authority and still 412s an invalid slot; this exists so the
 * picker never OFFERS one. Every rule below is copied from that function and
 * must be changed with it:
 *
 *   - the slot must parse and be strictly in the future
 *   - it must fall within the 7-day horizon
 *   - its restaurant-local day-of-week must have an hours row that is not
 *     isClosed and whose opensAt/closesAt both parse as HH:MM
 *   - its restaurant-local minutes-of-day must fall inside that window,
 *     including overnight windows where closesAt < opensAt (e.g. 18:00-02:00)
 *
 * TIMEZONE. FEASTY operates in Nigeria: WAT, UTC+1, no daylight saving. Both
 * sides shift a UTC instant by a fixed offset rather than using the device's
 * local zone, so a customer whose phone is set to another timezone still sees
 * and books the restaurant's hours.
 *
 * Pure and IO-free by design so the rules are unit-testable without a device.
 */

/** WAT is UTC+1 with no daylight saving. Mirrors scheduledOrders.ts. */
export const WAT_OFFSET_MS = 60 * 60 * 1000;

/** How far ahead a slot may be booked. Mirrors scheduledOrders.ts. */
export const SCHEDULE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/** Spacing between offered slots. A picker concern only - the server has no view on it. */
export const SLOT_INTERVAL_MINUTES = 30;

/**
 * The soonest a slot may be. Not a server rule: the release sweep flips a
 * scheduled order to placed at `scheduledFor - prepTimeMinutes`, so offering a
 * slot inside that window would release it immediately and make "schedule"
 * indistinguishable from "order now". 45m clears the 30m default prep config
 * with margin.
 */
export const SLOT_LEAD_MINUTES = 45;

export type RestaurantHours = {
  dayOfWeek: number;
  isClosed?: boolean | null;
  opensAt?: string | null;
  closesAt?: string | null;
};

export type ScheduleSlot = {
  /** The instant to send as `scheduledFor`. */
  iso: string;
  /** Restaurant-local day key, YYYY-MM-DD, for grouping. */
  dayKey: string;
  /** Restaurant-local HH:MM, for display. */
  timeLabel: string;
};

export type ScheduleSlotDay = {
  dayKey: string;
  /** 0=Sun..6=Sat, restaurant-local. */
  dayOfWeek: number;
  slots: ScheduleSlot[];
};

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

/** Restaurant-local day-of-week (0=Sun..6=Sat) for a UTC instant, in WAT. */
const localDayOfWeek = (utcMs: number) => new Date(utcMs + WAT_OFFSET_MS).getUTCDay();

/** Restaurant-local minutes-since-midnight for a UTC instant, in WAT. */
const localMinutesOfDay = (utcMs: number) => {
  const shifted = new Date(utcMs + WAT_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};

/** Restaurant-local YYYY-MM-DD for a UTC instant, in WAT. */
const localDayKey = (utcMs: number) => new Date(utcMs + WAT_OFFSET_MS).toISOString().slice(0, 10);

/** Restaurant-local HH:MM for a UTC instant, in WAT. */
const localTimeLabel = (utcMs: number) => {
  const shifted = new Date(utcMs + WAT_OFFSET_MS);
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

/** Parse a local "HH:MM" into minutes-since-midnight, or null if malformed. */
const parseHHMM = (value: unknown): number | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const match = HHMM_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
};

/**
 * The exact predicate validateScheduledSlot applies, minus the string parsing.
 * If this and the server ever disagree, the server wins and the customer sees a
 * 412 - which is the failure this function exists to prevent, not mask.
 */
export const isSlotOfferable = ({
  slotMs,
  hours,
  now,
  horizonMs = SCHEDULE_HORIZON_MS,
}: {
  slotMs: number;
  hours: RestaurantHours[];
  now: number;
  horizonMs?: number;
}): boolean => {
  if (!Number.isFinite(slotMs)) {
    return false;
  }
  if (slotMs <= now) {
    return false;
  }
  if (slotMs > now + horizonMs) {
    return false;
  }

  const day = localDayOfWeek(slotMs);
  const row = hours.find((entry) => Number(entry.dayOfWeek) === day) ?? null;
  if (!row || row.isClosed === true) {
    return false;
  }

  const opens = parseHHMM(row.opensAt);
  const closes = parseHHMM(row.closesAt);
  if (opens === null || closes === null) {
    // A day with no usable hours is treated as closed, exactly as the server does.
    return false;
  }

  const minutes = localMinutesOfDay(slotMs);
  return closes >= opens
    ? minutes >= opens && minutes <= closes
    : // Overnight window: open from opensAt to midnight OR midnight to closesAt.
      minutes >= opens || minutes <= closes;
};

/**
 * Every offerable slot in the horizon, grouped by restaurant-local day.
 *
 * Walks the horizon on a fixed grid and keeps only what isSlotOfferable accepts,
 * rather than deriving candidates from the hours rows - the predicate is then the
 * single place a rule lives, and an overnight window needs no special casing here.
 */
export const buildScheduleSlots = ({
  hours,
  now,
  horizonMs = SCHEDULE_HORIZON_MS,
  intervalMinutes = SLOT_INTERVAL_MINUTES,
  leadMinutes = SLOT_LEAD_MINUTES,
}: {
  hours: RestaurantHours[];
  now: number;
  horizonMs?: number;
  intervalMinutes?: number;
  leadMinutes?: number;
}): ScheduleSlotDay[] => {
  if (!Array.isArray(hours) || hours.length === 0) {
    return [];
  }

  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  const earliest = now + leadMinutes * 60 * 1000;

  // Start at the first interval boundary at or after `earliest`, so offered
  // times land on :00/:30 rather than on whatever minute checkout was opened.
  let cursor = Math.ceil(earliest / intervalMs) * intervalMs;
  const limit = now + horizonMs;

  const byDay = new Map<string, ScheduleSlotDay>();

  while (cursor <= limit) {
    if (isSlotOfferable({ slotMs: cursor, hours, now, horizonMs })) {
      const dayKey = localDayKey(cursor);
      const existing = byDay.get(dayKey);
      const slot: ScheduleSlot = {
        dayKey,
        iso: new Date(cursor).toISOString(),
        timeLabel: localTimeLabel(cursor),
      };
      if (existing) {
        existing.slots.push(slot);
      } else {
        byDay.set(dayKey, { dayKey, dayOfWeek: localDayOfWeek(cursor), slots: [slot] });
      }
    }
    cursor += intervalMs;
  }

  return Array.from(byDay.values());
};
