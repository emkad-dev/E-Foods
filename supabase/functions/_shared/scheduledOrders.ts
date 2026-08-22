// Scheduled-order slot validation and prep-time config (Task 18 / G2).
//
// Pure and dependency-free so it unit-tests without a database (runs in the
// type-checked `deno test` invocation). Two responsibilities:
//   * validateScheduledSlot — is a requested `scheduledFor` a legal slot?
//   * parseScheduledOrderConfig / DEFAULT_SCHEDULED_ORDER_CONFIG — the bounded
//     prep-time default the release sweep reads. G5 (Task 21) will refine
//     prep-time with a per-restaurant prediction; until then this bounded
//     config value is authoritative.
//
// TIMEZONE. FEASTY operates in Nigeria (WAT, UTC+1, no DST). RestaurantHours
// stores opensAt/closesAt as LOCAL "HH:MM" strings, one row per dayOfWeek
// (0=Sun .. 6=Sat). A `scheduledFor` arrives as a UTC instant; we shift it by
// WAT_OFFSET_MS and read the shifted date's UTC fields to recover the
// restaurant-local wall clock and day-of-week, then compare against THAT day's
// hours. This mirrors LAGOS_TIME_OFFSET_MS in _shared/domains/dispatch.ts — the
// comparison is done in restaurant-local time, never in UTC.

/** WAT is UTC+1 with no daylight saving. */
export const WAT_OFFSET_MS = 60 * 60 * 1000;

/** How far ahead a slot may be booked. Documented horizon: 7 days. */
export const SCHEDULE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export type RestaurantHoursRow = {
  dayOfWeek: number;
  isClosed?: boolean | null;
  opensAt?: string | null;
  closesAt?: string | null;
};

export type ScheduledSlotRejection =
  | 'invalid'
  | 'past'
  | 'beyond_horizon'
  | 'closed_day'
  | 'outside_hours';

export type ScheduledSlotResult =
  | { ok: true; scheduledForIso: string }
  | { ok: false; reason: ScheduledSlotRejection };

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

/** Restaurant-local day-of-week (0=Sun..6=Sat) for a UTC instant, in WAT. */
const localDayOfWeek = (utcMs: number) => new Date(utcMs + WAT_OFFSET_MS).getUTCDay();

/** Restaurant-local minutes-since-midnight for a UTC instant, in WAT. */
const localMinutesOfDay = (utcMs: number) => {
  const shifted = new Date(utcMs + WAT_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
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
 * Validates a requested scheduled slot against the restaurant's per-day hours.
 * A valid slot is (a) a parseable instant, (b) strictly in the future, (c)
 * within the horizon, and (d) inside the opening hours of its restaurant-local
 * day-of-week (respecting isClosed and missing/blank hours). Overnight windows
 * (closesAt < opensAt, e.g. 18:00–02:00) are supported.
 */
export const validateScheduledSlot = ({
  scheduledFor,
  hours,
  now = Date.now(),
  horizonMs = SCHEDULE_HORIZON_MS,
}: {
  scheduledFor: unknown;
  hours: RestaurantHoursRow[];
  now?: number;
  horizonMs?: number;
}): ScheduledSlotResult => {
  if (typeof scheduledFor !== 'string' || !scheduledFor.trim()) {
    return { ok: false, reason: 'invalid' };
  }
  const ts = Date.parse(scheduledFor);
  if (Number.isNaN(ts)) {
    return { ok: false, reason: 'invalid' };
  }
  if (ts <= now) {
    return { ok: false, reason: 'past' };
  }
  if (ts > now + horizonMs) {
    return { ok: false, reason: 'beyond_horizon' };
  }

  const day = localDayOfWeek(ts);
  const row = hours.find((entry) => Number(entry.dayOfWeek) === day) ?? null;
  if (!row || row.isClosed === true) {
    return { ok: false, reason: 'closed_day' };
  }

  const opens = parseHHMM(row.opensAt);
  const closes = parseHHMM(row.closesAt);
  if (opens === null || closes === null) {
    // A day with no usable hours is treated as closed.
    return { ok: false, reason: 'closed_day' };
  }

  const minutes = localMinutesOfDay(ts);
  const withinHours =
    closes >= opens
      ? minutes >= opens && minutes <= closes
      : // Overnight window: open from opensAt to midnight OR midnight to closesAt.
        minutes >= opens || minutes <= closes;
  if (!withinHours) {
    return { ok: false, reason: 'outside_hours' };
  }

  return { ok: true, scheduledForIso: new Date(ts).toISOString() };
};

/** Client-safe rejection copy for each reason. */
export const scheduledSlotRejectionMessage = (reason: ScheduledSlotRejection): string => {
  switch (reason) {
    case 'past':
      return 'Choose a scheduled time in the future.';
    case 'beyond_horizon':
      return 'Scheduled orders can be placed up to 7 days ahead.';
    case 'closed_day':
    case 'outside_hours':
      return 'The restaurant is closed at your selected time. Please pick a time within its opening hours.';
    default:
      return 'That scheduled time is not valid. Please pick another slot.';
  }
};

// ── prep-time config ───────────────────────────────────────────────────────
// The release sweep flips scheduled → placed at `scheduledFor − prepTimeMinutes`.
// Until G5 (Task 21) predicts prep time per restaurant, a single bounded config
// default is used, loaded through the never-throw platform-settings loader.

export type ScheduledOrderConfig = { prepTimeMinutes: number };

/** Default and fallback: a moderate 30-minute kitchen lead time. */
export const DEFAULT_SCHEDULED_ORDER_CONFIG: ScheduledOrderConfig = { prepTimeMinutes: 30 };

const PREP_MIN_MINUTES = 5;
const PREP_MAX_MINUTES = 180;

/**
 * Parses the PlatformSettings `scheduledOrders` row into a bounded config. A
 * missing/zero/negative/oversized value is clamped into [5, 180] minutes so a
 * mistyped setting can never release every scheduled order instantly (prep=0)
 * nor defer releases unreasonably. Mirrors parseAcceptanceDeadline's bounding.
 */
export const parseScheduledOrderConfig = (raw: unknown): ScheduledOrderConfig => {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const value = record.prepTimeMinutes;
  let prep = DEFAULT_SCHEDULED_ORDER_CONFIG.prepTimeMinutes;
  if (typeof value === 'number' && Number.isFinite(value)) {
    prep = value;
  } else if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      prep = parsed;
    }
  }
  prep = Math.round(prep);
  if (!Number.isFinite(prep) || prep < PREP_MIN_MINUTES) {
    prep = PREP_MIN_MINUTES;
  }
  if (prep > PREP_MAX_MINUTES) {
    prep = PREP_MAX_MINUTES;
  }
  return { prepTimeMinutes: prep };
};
