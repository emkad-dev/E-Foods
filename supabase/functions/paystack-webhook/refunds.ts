// Paystack refund webhooks (refund.pending / refund.processing /
// refund.needs-attention / refund.processed / refund.failed). The signature is
// verified by index.ts before this runs. Refund events carry no `reference`
// field (they carry transaction_reference and refund_reference), so index.ts
// routes them here BEFORE its missing-reference check.
//
// This file only turns the event into the input of applyRefundWebhook
// (_shared/paystackRefund.ts), which matches it to the order and applies it
// idempotently. Kept free of the database client so it tests in isolation.
// Event shape: https://paystack.com/docs/payments/refunds/#listen-to-notifications

import type { RefundWebhookInput } from '../_shared/paystackRefund.ts';

export const REFUND_EVENTS = [
  'refund.pending',
  'refund.processing',
  'refund.needs-attention',
  'refund.processed',
  'refund.failed',
] as const;

export const isRefundEvent = (eventType: string): boolean => (REFUND_EVENTS as readonly string[]).includes(eventType);

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');

const kobo = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};

/** The event's status: the event name is authoritative, data.status the fallback. */
export const parseRefundWebhook = (eventType: string, data: Record<string, unknown> | null): RefundWebhookInput => {
  const transaction = data?.transaction;
  const transactionReference =
    text(data?.transaction_reference) ||
    (transaction && typeof transaction === 'object' ? text((transaction as Record<string, unknown>).reference) : '');
  return {
    amountKobo: kobo(data?.amount),
    paystackRefundId: text(data?.id) || null,
    reason: text(data?.reason) || text(data?.gateway_response) || null,
    // Only refund_reference: a generic `reference` could be the charge's, and
    // matching on the wrong one would ignore a real event.
    refundReference: text(data?.refund_reference) || null,
    status: eventType.startsWith('refund.') ? eventType : text(data?.status),
    transactionReference,
  };
};
