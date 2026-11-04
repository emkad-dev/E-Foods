// Customer order confirmation: pure rules.
//
// After a RESTAURANT marks an order delivered/collected the customer confirms
// receipt (or reports a problem); an order nobody confirms closes itself 3
// hours after completion. Everything here is a pure function of values passed
// in - no client, no clock reads - so the sweep, the RPC handlers and the tests
// all share one definition of "when is a reminder due".

const MINUTE_MS = 60_000;

/** How long a customer has to confirm before the order closes on its own. */
export const CUSTOMER_CONFIRM_WINDOW_MS = 3 * 60 * MINUTE_MS;

/**
 * Reminder stages 1-3, as offsets from the moment the restaurant marked the
 * order complete. The last one lands 30 minutes before the window closes.
 */
export const CUSTOMER_CONFIRM_REMINDER_OFFSETS_MS = [30 * MINUTE_MS, 90 * MINUTE_MS, 150 * MINUTE_MS] as const;

export type CustomerConfirmReminderStage = 1 | 2 | 3;

// Africa/Lagos is UTC+1 all year (Nigeria has no DST), so a fixed offset is
// exact and spares us an Intl timezone lookup in the edge runtime.
const LAGOS_UTC_OFFSET_HOURS = 1;
const QUIET_HOURS_START = 22;
const QUIET_HOURS_END = 7;

/** True between 22:00 and 07:00 Africa/Lagos, when no reminder push may go out. */
export const isLagosQuietHours = (now: Date): boolean => {
  const lagosHour = (now.getUTCHours() + LAGOS_UTC_OFFSET_HOURS) % 24;
  return lagosHour >= QUIET_HOURS_START || lagosHour < QUIET_HOURS_END;
};

const toTimestamp = (value: string | Date | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

/**
 * Which reminder, if any, a sweep running at `now` should send for an order
 * whose confirmation window closes at `dueAt`.
 *
 * `remindersSent` is the highest stage already consumed (sent, or skipped
 * because a later one superseded it). Only the LATEST due stage is returned:
 * if a stage fell due in quiet hours, or the sweep was late, the next eligible
 * sweep sends one reminder and the caller stores that stage as the new
 * `remindersSent`, which consumes every earlier stage with it. The customer
 * never receives a burst.
 *
 * Returns null while quiet hours apply and from `dueAt` on (the order is about
 * to close; a reminder for a closed order would only confuse). The caller is
 * responsible for not asking about orders that are confirmed or reported.
 */
export const getReminderDecision = (input: {
  dueAt: string | Date | null | undefined;
  remindersSent: number;
  now: Date;
}): CustomerConfirmReminderStage | null => {
  const dueAtMs = toTimestamp(input.dueAt);
  if (dueAtMs === null) {
    return null;
  }

  const nowMs = input.now.getTime();
  if (nowMs >= dueAtMs || isLagosQuietHours(input.now)) {
    return null;
  }

  // Offsets are measured from completion, and dueAt is completion + window.
  const completedAtMs = dueAtMs - CUSTOMER_CONFIRM_WINDOW_MS;
  for (let index = CUSTOMER_CONFIRM_REMINDER_OFFSETS_MS.length - 1; index >= 0; index -= 1) {
    const stage = (index + 1) as CustomerConfirmReminderStage;
    if (stage <= input.remindersSent) {
      return null;
    }
    if (nowMs >= completedAtMs + CUSTOMER_CONFIRM_REMINDER_OFFSETS_MS[index]) {
      return stage;
    }
  }
  return null;
};

/**
 * An order is awaiting the customer when the restaurant completed it through
 * the partner action (which is the only thing that sets the deadline), and the
 * customer has not confirmed. A reported order still counts: reporting stops
 * the auto-close timer but the customer may confirm afterwards.
 */
export const isAwaitingCustomerConfirmation = (order: {
  status?: string | null;
  customerConfirmDueAt?: string | null;
  customerConfirmedAt?: string | null;
  customerIssueReportedAt?: string | null;
}): boolean =>
  order.status === 'delivered' &&
  Boolean(order.customerConfirmDueAt) &&
  !order.customerConfirmedAt;
