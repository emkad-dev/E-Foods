/**
 * An order's step times, from its `timeline` record, in the order they
 * happened.
 *
 * Every status change writes a timestamp into CustomerOrder.timeline --
 * placedAt, paidAt, acceptedAt, preparingAt, readyAt, pickedUpAt, onTheWayAt,
 * deliveredAt, cancelledAt and more -- and the admin's order-detail read
 * already returns it. Order detail never showed it, so the admin could not see
 * when the restaurant accepted or the order was delivered.
 *
 * Pure: no imports, so it runs under plain `node --test`.
 */

export type ProgressStep = {
  key: string;
  label: string;
  /** The ISO timestamp as recorded. */
  at: string;
  /** A deadline rather than something that happened. */
  due: boolean;
};

const STEP_LABELS: Record<string, string> = {
  placedAt: 'Placed',
  paidAt: 'Paid',
  confirmedAt: 'Confirmed',
  acceptedAt: 'Accepted by the restaurant',
  preparingAt: 'Preparing',
  readyAt: 'Ready',
  pickedUpAt: 'Picked up',
  onTheWayAt: 'On the way',
  deliveredAt: 'Delivered',
  rejectedAt: 'Rejected',
  cancelledAt: 'Cancelled',
  paymentTimedOutAt: 'Payment timed out',
  paymentInitializationFailedAt: 'Payment failed to start',
  attentionResolvedAt: 'Admin resolved the flag',
  customerConfirmDueAt: 'Customer confirmation due',
};

const DUE_KEYS: ReadonlySet<string> = new Set(['customerConfirmDueAt']);

/** "somethingNewAt" -> "Something new", for keys added after this list. */
const humanizeKey = (key: string) => {
  const words = key
    .replace(/At$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
};

export const buildProgressSteps = (timeline: Record<string, unknown> | null | undefined): ProgressStep[] => {
  if (!timeline || typeof timeline !== 'object') {
    return [];
  }

  const steps: ProgressStep[] = [];

  for (const [key, value] of Object.entries(timeline)) {
    // Only timestamp keys, and only values that parse: a malformed entry is
    // skipped rather than rendered as "Invalid Date".
    if (!key.endsWith('At') || typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
      continue;
    }

    steps.push({ key, label: STEP_LABELS[key] ?? humanizeKey(key), at: value, due: DUE_KEYS.has(key) });
  }

  return steps.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.key.localeCompare(right.key));
};
