/**
 * Paystack refund execution rules, shared by the edge functions (the refund
 * initiation, the refund webhook, the admin RPC), the admin web console (when to
 * offer "Refund via Paystack") and the customer app (what to call the refund).
 *
 * The REFUND RECORD is the payment's status 'refunded' + refundAmount, written
 * when a paid order closes. The EXECUTION is the Paystack refund that actually
 * returns that money, tracked in `payment.refundExecution`. One execution per
 * order: a new one may start only when none exists or the last one failed (a
 * failed Paystack refund credits the money back to FEASTY, so a retry cannot
 * pay twice).
 *
 * Imports nothing: it runs under Deno, Node's test runner and Vite alike.
 */

export const REFUND_EXECUTION_STATUSES = [
  'requested',
  'pending',
  'processing',
  'processed',
  'failed',
  'needs_attention',
] as const;
export type RefundExecutionStatus = (typeof REFUND_EXECUTION_STATUSES)[number];

export type RefundExecution = {
  /** Naira sent to Paystack for this attempt (the recorded refundAmount). */
  amount: number | null;
  /** 1 for the first attempt, +1 for each retry after a failure. */
  attempt: number;
  failedAt: string | null;
  lastError: string | null;
  paystackRefundId: string | null;
  processedAt: string | null;
  /** Our refund reference at Paystack, unique per attempt (Paystack refuses a reused one). */
  reference: string | null;
  requestedAt: string | null;
  /** 'admin:<uid>' or 'auto'. */
  requestedBy: string | null;
  status: RefundExecutionStatus;
};

type PaymentLike = Record<string, unknown> | null | undefined;

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const isExecutionStatus = (value: unknown): value is RefundExecutionStatus =>
  typeof value === 'string' && (REFUND_EXECUTION_STATUSES as readonly string[]).includes(value);

/**
 * The stored execution, or null when none was started. A present value with an
 * unknown status is NOT treated as absent: it reads as needs_attention, so a
 * corrupt record can never open the door to a second refund.
 */
export const readRefundExecution = (payment: PaymentLike): RefundExecution | null => {
  const raw = payment?.refundExecution;
  if (raw === undefined || raw === null) return null;
  const record = (typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const attempt = typeof record.attempt === 'number' && Number.isInteger(record.attempt) && record.attempt > 0 ? record.attempt : 1;
  const paystackRefundId =
    typeof record.paystackRefundId === 'number' ? String(record.paystackRefundId) : text(record.paystackRefundId);
  const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? record.amount : null;
  return {
    amount,
    attempt,
    failedAt: text(record.failedAt),
    lastError: text(record.lastError),
    paystackRefundId,
    processedAt: text(record.processedAt),
    reference: text(record.reference),
    requestedAt: text(record.requestedAt),
    requestedBy: text(record.requestedBy),
    status: isExecutionStatus(record.status) ? record.status : 'needs_attention',
  };
};

/** A new Paystack refund may start only when none exists or the last one failed. */
export const canStartRefundExecution = (execution: RefundExecution | null): boolean =>
  execution === null || execution.status === 'failed';

export type RefundEligibility =
  | { amount: number; ok: true; transactionReference: string }
  | {
      ok: false;
      reason: 'already_started' | 'no_amount' | 'no_reference' | 'not_captured' | 'not_paystack' | 'not_recorded' | 'over_cap';
    };

const toAmount = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const PAYSTACK_METHODS = ['card', 'bank_transfer'];

/**
 * Whether a Paystack refund of this order's recorded refund may be sent, and
 * for how much. `captured` is the caller's "money was taken" verdict (the
 * server's isPaymentCaptured / the apps' hasCapturedPayment).
 *
 * The amount is ALWAYS the recorded refundAmount, never more than what this
 * order captured, and never a payment whose refund was not recorded first.
 */
export const assessPaystackRefund = (payment: PaymentLike, captured: boolean): RefundEligibility => {
  const stored = payment ?? {};
  if (stored.status !== 'refunded') return { ok: false, reason: 'not_recorded' };
  if (!captured) return { ok: false, reason: 'not_captured' };
  const method = text(stored.method);
  const provider = text(stored.provider);
  if (!method || !PAYSTACK_METHODS.includes(method) || (provider !== null && provider !== 'paystack')) {
    return { ok: false, reason: 'not_paystack' };
  }
  const transactionReference = text(stored.reference);
  if (!transactionReference) return { ok: false, reason: 'no_reference' };
  if (!canStartRefundExecution(readRefundExecution(stored))) return { ok: false, reason: 'already_started' };

  const amount = toAmount(stored.refundAmount);
  if (amount === null || amount <= 0) return { ok: false, reason: 'no_amount' };
  const capturedAmount = toAmount(stored.capturedAmount);
  // Without a captured amount there is nothing to cap against: refuse rather
  // than trust refundAmount alone.
  if (capturedAmount === null || capturedAmount <= 0 || amount > capturedAmount) {
    return { ok: false, reason: 'over_cap' };
  }
  return { amount, ok: true, transactionReference };
};

/** Paystack's refund statuses (webhook event suffixes and API `status`) mapped to ours. */
export const mapPaystackRefundStatus = (value: unknown): RefundExecutionStatus | null => {
  const status = text(value)?.toLowerCase().replace(/^refund\./, '');
  switch (status) {
    case 'pending':
      return 'pending';
    case 'processing':
      return 'processing';
    case 'processed':
      return 'processed';
    case 'failed':
      return 'failed';
    case 'needs-attention':
    case 'needs_attention':
      return 'needs_attention';
    default:
      return null;
  }
};

const STATUS_RANK: Record<RefundExecutionStatus, number> = {
  requested: 0,
  pending: 1,
  needs_attention: 2,
  processing: 2,
  failed: 3,
  processed: 3,
};

/**
 * Whether a refund event moves the execution forward. processed and failed are
 * final (a redelivered or late event changes nothing); otherwise only a later
 * stage applies, except that needs_attention and processing may replace each
 * other (Paystack resumes processing once bank details are given).
 */
export const shouldApplyRefundStatus = (current: RefundExecutionStatus, next: RefundExecutionStatus): boolean => {
  if (current === next || STATUS_RANK[current] === 3) return false;
  if (STATUS_RANK[next] > STATUS_RANK[current]) return true;
  // processing <-> needs_attention (both rank 2).
  return STATUS_RANK[next] === 2 && STATUS_RANK[current] === 2;
};

/** The money is with the processor or already returned: "on its way" is true. */
export const isRefundOnItsWay = (payment: PaymentLike): boolean => {
  const status = readRefundExecution(payment)?.status;
  return status === 'processing' || status === 'processed';
};

/** Admin-facing words for an execution status. */
export const describeRefundExecutionStatus = (status: RefundExecutionStatus): string => {
  switch (status) {
    case 'requested':
      return 'Requested from Paystack';
    case 'pending':
      return 'Pending at Paystack';
    case 'processing':
      return 'Processing';
    case 'processed':
      return 'Processed';
    case 'failed':
      return 'Failed';
    case 'needs_attention':
      return 'Needs attention';
  }
};
