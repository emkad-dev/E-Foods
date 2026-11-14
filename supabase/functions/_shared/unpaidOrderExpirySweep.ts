// Unpaid-order expiry sweep, run by queue-drainer on the every-minute pg_cron
// schedule that already exists (no new cron entry, secret or schedule).
//
// Before this sweep an unpaid checkout was only expired when someone happened to
// READ it (maybeExpireUnpaidOrder), so an order nobody opened stayed 'placed'
// forever - three failed-payment orders sat placed from June. This sweep finds
// prepaid orders whose payment was never captured (pending, or failed) and whose
// window has run out - 15 minutes for card, 35 for bank transfer - and cancels
// them through expireUnpaidOrder, the same conditional write the lazy path uses.
//
// RACES are closed by that write, never by the snapshot read here: it matches
// only while the order status AND the payment status are still what this sweep
// read, so a webhook that marks the order paid in between wins and the sweep
// no-ops. A payment that lands after the cancel is the verification's
// closed-order safeguard's job.
//
// Nothing here throws to the caller: queue-drainer's own job draining must not
// fail because this sweep had a bad minute, and one bad order must not abort the
// batch - both mirror sweepCustomerConfirmations.

import { serviceClient } from './client.ts';
import { logEdgeEvent } from './observability.ts';
import {
  CUSTOMER_ORDER_COLUMNS,
  type CustomerOrderRow,
  expireUnpaidOrder,
  PAYSTACK_PAYMENT_METHODS,
  paymentTimeoutMsForMethod,
  UNCAPTURED_PAYMENT_STATUSES,
  UNPAID_EXPIRY_ORDER_STATUSES,
} from './orders.ts';

/** Bounded per run AND per payment method. Each method is queried with its own
 * cut-off, so bank transfers still inside their 35 minutes can never fill the
 * batch and starve expired card orders (or the reverse). Oldest first and
 * idempotent, so a straggler beyond the cap is picked up next minute. */
const UNPAID_EXPIRY_SWEEP_LIMIT_PER_METHOD = 50;

export type UnpaidOrderExpirySweepResult = {
  /** Orders this run cancelled because their payment window ran out. */
  expired: number;
  /** Candidates that produced no change (lost a race to a payment, not yet
   * due, malformed, or errored). */
  skipped: number;
};

const loadCandidates = async (method: string, nowMs: number): Promise<CustomerOrderRow[]> => {
  const cutoffIso = new Date(nowMs - paymentTimeoutMsForMethod(method)).toISOString();
  const { data, error } = await serviceClient
    .from('CustomerOrder')
    .select(CUSTOMER_ORDER_COLUMNS)
    .in('status', UNPAID_EXPIRY_ORDER_STATUSES)
    .eq('payment->>method', method)
    .in('payment->>status', UNCAPTURED_PAYMENT_STATUSES)
    .lt('createdAt', cutoffIso)
    .order('createdAt', { ascending: true })
    .limit(UNPAID_EXPIRY_SWEEP_LIMIT_PER_METHOD);

  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as CustomerOrderRow[];
};

/**
 * Runs the sweep. Safe to call as often as you like: an order is cancelled at
 * most once, and its promo release, event and notifications go out only with
 * the write that cancelled it.
 */
export const sweepUnpaidOrders = async (now: Date = new Date()): Promise<UnpaidOrderExpirySweepResult> => {
  const result: UnpaidOrderExpirySweepResult = { expired: 0, skipped: 0 };
  const nowMs = now.getTime();

  for (const method of PAYSTACK_PAYMENT_METHODS) {
    let candidates: CustomerOrderRow[] = [];
    try {
      candidates = await loadCandidates(method, nowMs);
    } catch (error) {
      logEdgeEvent('error', 'unpaid order expiry candidate lookup failed', {
        error: error instanceof Error ? error.message : String(error),
        method,
      });
      continue;
    }

    for (const order of candidates) {
      try {
        const outcome = await expireUnpaidOrder(order, nowMs);
        if (outcome.expired) {
          result.expired += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        // One bad order must not abort the batch.
        result.skipped += 1;
        logEdgeEvent('error', 'unpaid order expiry failed for order', {
          error: error instanceof Error ? error.message : String(error),
          orderId: order.id,
        });
      }
    }
  }

  return result;
};
