// Pure, Node-testable rules for the customer's post-delivery confirmation
// (confirm received / report a problem). No RPC or React imports on purpose:
// the order screen and the home prompt both decide what to show from here, and
// the wiring that calls the server lives in services/customerOrderActions.ts.
//
// Shared with the node test runner, so the one cross-package import carries an
// explicit extension (same constraint as utils/orderTrackingSummary.ts).
import { normalizeOrderStatus } from '../../../../packages/domain/src/orders.ts';

/**
 * The slice of an order snapshot this flow reads. Structural on purpose so the
 * list payload, the detail payload and test fixtures all satisfy it.
 */
export type ConfirmationOrderFields = {
  customerConfirmDueAt?: string | null;
  customerConfirmationSource?: 'customer' | 'auto' | null;
  customerConfirmedAt?: string | null;
  customerIssueReportedAt?: string | null;
  status?: string | null;
};

export type ConfirmationPhase =
  /** Not in the flow: rider-confirmed, pre-feature, or not delivered. */
  | 'none'
  /** Restaurant completed it; the customer has not answered. Timer running. */
  | 'awaiting'
  /** Customer reported a problem. Timer stopped; confirm is still possible. */
  | 'reported'
  | 'confirmed'
  | 'auto_closed';

export const MAX_PROBLEM_LENGTH = 500;

export const CONFIRM_LABELS = {
  delivery: 'I received my order',
  pickup: "I've collected my order",
} as const;

/**
 * Which state the confirmation card is in. In the flow only when the server set
 * a deadline: `status` stays `delivered` throughout, so the deadline is the sole
 * marker that separates a restaurant-completed order from a rider-confirmed or
 * pre-feature one.
 */
export const getConfirmationPhase = (order: ConfirmationOrderFields): ConfirmationPhase => {
  if (normalizeOrderStatus(order.status) !== 'delivered' || !order.customerConfirmDueAt) {
    return 'none';
  }
  if (order.customerConfirmedAt) {
    return order.customerConfirmationSource === 'auto' ? 'auto_closed' : 'confirmed';
  }
  return order.customerIssueReportedAt ? 'reported' : 'awaiting';
};

const toTimestamp = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The order the home prompt should point at: the most recently completed one
 * still awaiting an answer. A reported order is deliberately excluded - the
 * timer is already stopped and FEASTY has it, so home has nothing left to ask;
 * the order screen still offers confirm.
 *
 * Takes unknown entries because the list comes straight off an RPC payload.
 */
export const pickOrderAwaitingConfirmation = <T extends ConfirmationOrderFields>(
  orders: readonly (T | unknown)[]
): T | null => {
  let best: T | null = null;
  for (const entry of orders) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const candidate = entry as T;
    if (getConfirmationPhase(candidate) !== 'awaiting') {
      continue;
    }
    if (!best || toTimestamp(candidate.customerConfirmDueAt) > toTimestamp(best.customerConfirmDueAt)) {
      best = candidate;
    }
  }
  return best;
};

/**
 * "Closes automatically at 9:40 PM" in the device's own time, or null when
 * there is no future deadline to name. A past time is dropped rather than shown:
 * the sweep closes an order within about a minute of its deadline, and until it
 * does, a time already gone would read as if the order were closed.
 *
 * `options` exists for tests; the app passes nothing and gets the device locale.
 */
export const formatAutoCloseNotice = (
  dueAt: string | null | undefined,
  now: Date = new Date(),
  options: { locale?: string; timeZone?: string } = {}
): string | null => {
  const due = toTimestamp(dueAt);
  if (!due || due <= now.getTime()) {
    return null;
  }
  const time = new Date(due).toLocaleTimeString(options.locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  return `Closes automatically at ${time}`;
};

export type ProblemMessageCheck = { ok: true; message: string } | { ok: false; error: string };

/**
 * Client-side guard for the report form. The server enforces the same rules
 * independently; this only saves a round trip and words the refusal.
 */
export const validateProblemMessage = (raw: string): ProblemMessageCheck => {
  const message = raw.trim();
  if (!message) {
    return { error: 'Please describe the problem.', ok: false };
  }
  if (message.length > MAX_PROBLEM_LENGTH) {
    return { error: `Please keep the description under ${MAX_PROBLEM_LENGTH} characters.`, ok: false };
  }
  return { message, ok: true };
};
