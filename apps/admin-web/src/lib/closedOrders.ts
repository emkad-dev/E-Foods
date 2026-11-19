/**
 * Cancelled, rejected and failed-delivery orders, as the admin snapshot's
 * `closedOrders` list carries them.
 *
 * The reporting feed (`orders`) leaves these out on purpose -- they were never
 * paid or never served, so they must not count as revenue -- but leaving them
 * out ENTIRELY made 119 of 132 production orders invisible (2026-11-17): a
 * customer's cancellation or a restaurant's rejection could only be found by
 * typing its exact id. They now travel as their own list, and these helpers
 * turn each one into words an operator can read.
 *
 * Pure: no imports, so it runs under plain `node --test`.
 */

export type ClosedOrderLike = {
  status?: string | null;
  cancellation?: { actor?: string | null; reason?: string | null } | null;
};

export type ClosureDescription = {
  /** Why the order closed, in plain words. */
  why: string;
  /** Who closed it. */
  by: string;
};

/**
 * Every cancellation reason the backend writes on purpose. Anything else still
 * renders, humanised from its code, so a new reason is never hidden.
 */
const REASON_LABELS: Record<string, string> = {
  payment_timeout: 'Payment timed out',
  payment_initialization_failed: 'Payment never started',
  payment_failed: 'Payment failed',
  acceptance_deadline: 'Restaurant did not respond in time',
  admin_force_cancel: 'Cancelled by an admin',
  dispatch_escalation: 'Cancelled after a dispatch escalation',
};

const ACTOR_LABELS: Record<string, string> = {
  admin: 'Admin',
  customer: 'Customer',
  partner: 'Restaurant',
  restaurant: 'Restaurant',
  system: 'System',
};

/** Cancellations that were an abandoned or failed checkout, not a decision. */
export const PAYMENT_CLOSURE_REASONS: ReadonlySet<string> = new Set([
  'payment_timeout',
  'payment_initialization_failed',
  'payment_failed',
]);

const humanize = (code: string) => {
  const words = code.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
};

export const describeClosure = (order: ClosedOrderLike): ClosureDescription => {
  const status = (order.status ?? '').toLowerCase();
  const actor = (order.cancellation?.actor ?? '').toLowerCase();
  const reason = (order.cancellation?.reason ?? '').toLowerCase();

  // A rejection is the restaurant's decision even when no cancellation object
  // was written, which is the case for every rejected order in production.
  const by = ACTOR_LABELS[actor] ?? (status === 'rejected' ? 'Restaurant' : actor ? humanize(actor) : '—');

  if (reason) {
    return { why: REASON_LABELS[reason] ?? humanize(reason), by };
  }

  if (status === 'rejected') return { why: 'Rejected by the restaurant', by };
  if (status === 'failed_delivery') return { why: 'Delivery failed', by };
  if (actor === 'customer') return { why: 'Cancelled by the customer', by };
  if (actor === 'admin') return { why: 'Cancelled by an admin', by };
  if (actor === 'system') return { why: 'Cancelled automatically', by };

  return { why: 'No reason recorded', by };
};

export type ClosedOrderSummary = {
  cancelled: number;
  rejected: number;
  failedDelivery: number;
  /** Cancelled because the payment timed out, never started or failed. */
  unpaidCheckouts: number;
  /** Cancelled by the customer. */
  byCustomer: number;
  /** Cancelled for any other reason (admin, deadline, dispatch...). */
  otherCancelled: number;
};

export const summarizeClosedOrders = (orders: ClosedOrderLike[]): ClosedOrderSummary => {
  const summary: ClosedOrderSummary = {
    cancelled: 0,
    rejected: 0,
    failedDelivery: 0,
    unpaidCheckouts: 0,
    byCustomer: 0,
    otherCancelled: 0,
  };

  for (const order of orders) {
    const status = (order.status ?? '').toLowerCase();

    if (status === 'rejected') {
      summary.rejected += 1;
    } else if (status === 'failed_delivery') {
      summary.failedDelivery += 1;
    } else if (status === 'cancelled') {
      summary.cancelled += 1;
      const reason = (order.cancellation?.reason ?? '').toLowerCase();
      const actor = (order.cancellation?.actor ?? '').toLowerCase();

      if (PAYMENT_CLOSURE_REASONS.has(reason)) {
        summary.unpaidCheckouts += 1;
      } else if (actor === 'customer') {
        summary.byCustomer += 1;
      } else {
        summary.otherCancelled += 1;
      }
    }
  }

  return summary;
};

/**
 * The caption under the Dashboard's "Cancelled orders" tile: what the count is
 * made of, so 59 abandoned checkouts are never read as 59 unhappy customers.
 */
export const describeCancelledBreakdown = (summary: ClosedOrderSummary): string => {
  if (summary.cancelled === 0) {
    return 'None in this period';
  }

  const parts = [
    summary.unpaidCheckouts > 0 ? `${summary.unpaidCheckouts} unpaid checkout${summary.unpaidCheckouts === 1 ? '' : 's'}` : null,
    summary.byCustomer > 0 ? `${summary.byCustomer} by customer${summary.byCustomer === 1 ? '' : 's'}` : null,
    summary.otherCancelled > 0 ? `${summary.otherCancelled} other` : null,
  ].filter((part): part is string => part !== null);

  return parts.join(', ');
};
