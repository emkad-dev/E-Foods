// The acceptance deadline: how long an order may sit 'placed' before the
// platform escalates it, and (at 2x that) auto-cancels it with a full refund.
// Tunable via `PlatformSettings` (`id = 'acceptanceDeadline'`) without a
// deploy, exactly the way dispatchWeights.ts / dispatchTracking.ts are. This
// file holds the pure, DB-free type/default/parser so it can be unit-tested
// directly; the loader that reads PlatformSettings, caches, and never throws
// lives in platformSettings.ts (`loadAcceptanceDeadlineConfig`), matching
// `loadDispatchTrackingConfig` exactly.

export interface AcceptanceDeadlineConfig {
  /** Minutes an order may sit 'placed' before escalation; 2x this = auto-cancel. */
  acceptanceDeadlineMinutes: number;
}

export const DEFAULT_ACCEPTANCE_DEADLINE: AcceptanceDeadlineConfig = {
  acceptanceDeadlineMinutes: 8,
};

// Bounds keep a mistyped admin value from breaking the sweep. This number is
// the age threshold every fresh order is measured against: a zero, negative,
// or non-finite deadline would make EVERY just-placed order instantly overdue
// (escalated, then cancelled-with-refund on the very next minute) — a mistyped
// setting must never silently start refunding live orders. An absurdly large
// value would mean nothing ever escalates. So the field must already be a
// finite JS `number` (not a coerced `Number(null) === 0` masquerading as
// valid), strictly positive, and within a generous upper bound. Anything else
// falls back to the default whole — same posture as parseDispatchTracking.
export const MIN_ACCEPTANCE_DEADLINE_MINUTES = 1;
export const MAX_ACCEPTANCE_DEADLINE_MINUTES = 120;

export const parseAcceptanceDeadline = (raw: unknown): AcceptanceDeadlineConfig => {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_ACCEPTANCE_DEADLINE;
  }

  const record = raw as Record<string, unknown>;
  const acceptanceDeadlineMinutes = record.acceptanceDeadlineMinutes;

  const valid =
    typeof acceptanceDeadlineMinutes === 'number' &&
    Number.isFinite(acceptanceDeadlineMinutes) &&
    acceptanceDeadlineMinutes >= MIN_ACCEPTANCE_DEADLINE_MINUTES &&
    acceptanceDeadlineMinutes <= MAX_ACCEPTANCE_DEADLINE_MINUTES;

  return valid ? { acceptanceDeadlineMinutes } : DEFAULT_ACCEPTANCE_DEADLINE;
};
