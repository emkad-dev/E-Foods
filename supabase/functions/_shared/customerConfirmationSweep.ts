// Customer order confirmation sweep, run by queue-drainer on the every-minute
// pg_cron schedule that already exists (no new cron entry, secret or schedule).
//
// After a RESTAURANT marks an order delivered/collected the customer has 3
// hours to confirm. This sweep does the two time-driven halves of that flow:
//   * up to three reminder pushes (30 / 90 / 150 minutes after completion), and
//   * closing the order silently once the 3 hours are up.
// The rules for WHEN a reminder is due (quiet hours, catch-up sends one) live in
// customerConfirmation.ts; this file only reads candidates and applies them.
//
// "Reporting a problem stops the timer" is implemented HERE, by the candidate
// filter: a report sets customerIssueReportedAt but leaves customerConfirmDueAt
// in place, so an order with that flag set is simply never a candidate. The same
// goes for a confirmed order.
//
// RACES are closed by compare-and-swap writes, never by the snapshot this
// function read:
//   * a reminder is CLAIMED (customerConfirmRemindersSent: n -> stage, while the
//     order is still delivered, unconfirmed and unreported) BEFORE the push goes
//     out. Two overlapping sweeps both read n; only one UPDATE matches, so only
//     one pushes. Claim-then-push means a crash between the two loses a reminder
//     rather than doubling one, which is the right way round for a nudge.
//   * auto-close uses updateDeliveredOrderIfNull, so a confirm or report that
//     lands between this sweep's read and its write wins and the close no-ops.
//
// Nothing here throws to the caller: queue-drainer's own job draining must not
// fail because this sweep had a bad minute, and one bad order must not abort the
// batch - both mirror sweepUnacceptedOrders.

import { serviceClient } from './client.ts';
import {
  type CustomerConfirmReminderStage,
  getReminderDecision,
  isAwaitingCustomerConfirmation,
} from './customerConfirmation.ts';
import { buildNotificationData, notifyUsers } from './notifications.ts';
import { logEdgeEvent } from './observability.ts';
import {
  type CustomerOrderRow,
  ORDER_STATUS,
  updateDeliveredOrderIfNull,
} from './orders.ts';

/** Bounded per run. Candidates are oldest-due first and the sweep is idempotent,
 * so a straggler beyond the cap is simply picked up on the next minute. */
const CONFIRMATION_SWEEP_LIMIT = 100;

export type CustomerConfirmationSweepResult = {
  /** Orders this run closed because the 3 hours ran out. */
  autoClosed: number;
  /** Reminder pushes this run claimed and sent. */
  reminded: number;
  /** Candidates that produced no change (nothing due yet, quiet hours, lost a
   * race, or malformed). */
  skipped: number;
};

/** Only what the sweep reads. This runs every minute, so it must not pull the
 * full CUSTOMER_ORDER_COLUMNS (payment.paystackResponse, deliveryCode, ...). */
const CONFIRMATION_SWEEP_COLUMNS =
  'id,customerId,fulfillmentType,status,customerConfirmDueAt,customerConfirmedAt,customerIssueReportedAt,customerConfirmRemindersSent';

type ConfirmationCandidate = Pick<
  CustomerOrderRow,
  | 'customerConfirmDueAt'
  | 'customerConfirmedAt'
  | 'customerConfirmRemindersSent'
  | 'customerId'
  | 'customerIssueReportedAt'
  | 'fulfillmentType'
  | 'id'
  | 'status'
>;

const reminderCopy = (
  stage: CustomerConfirmReminderStage,
  order: ConfirmationCandidate
): { body: string; title: string } => {
  const code = order.id.slice(-6).toUpperCase();
  const verb = order.fulfillmentType === 'pickup' ? 'collected' : 'received';

  switch (stage) {
    case 1:
      return {
        title: order.fulfillmentType === 'pickup' ? 'Did you collect your order?' : 'Did your order arrive?',
        body: `Order ${code} was marked complete by the restaurant. Tap to confirm you ${verb} it.`,
      };
    case 2:
      return {
        title: 'Please confirm your order',
        body: `We still need you to confirm you ${verb} order ${code}. If something is wrong, you can report a problem.`,
      };
    default:
      return {
        title: 'Your order closes in 30 minutes',
        body: `Order ${code} will close automatically in 30 minutes. Confirm you ${verb} it now, or report a problem to keep it open.`,
      };
  }
};

/** Claims `stage` for the order. True only if THIS call moved the counter, i.e.
 * nobody else claimed it, confirmed it or reported it since the read. */
const claimReminder = async (order: ConfirmationCandidate, stage: CustomerConfirmReminderStage) => {
  const { data, error } = await serviceClient
    .from('CustomerOrder')
    // updatedAt is left alone: a reminder claim changes nothing a client shows,
    // so it needs neither a realtime broadcast nor a refetch.
    .update({ customerConfirmRemindersSent: stage })
    .eq('id', order.id)
    .eq('status', ORDER_STATUS.DELIVERED)
    .eq('customerConfirmRemindersSent', order.customerConfirmRemindersSent ?? 0)
    .is('customerConfirmedAt', null)
    .is('customerIssueReportedAt', null)
    .select('id');

  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) && data.length > 0;
};

const sendReminder = async (
  order: ConfirmationCandidate,
  stage: CustomerConfirmReminderStage,
  result: CustomerConfirmationSweepResult
) => {
  if (!(await claimReminder(order, stage))) {
    result.skipped += 1;
    return;
  }

  // notifyUsers is best-effort internally and does not throw.
  await notifyUsers([order.customerId], {
    ...reminderCopy(stage, order),
    data: buildNotificationData({
      app: 'customer',
      orderId: order.id,
      routeKey: 'customer_order_detail',
      status: ORDER_STATUS.DELIVERED,
      type: 'order_confirmation_reminder',
    }),
  });
  result.reminded += 1;
};

const autoCloseOrder = async (order: ConfirmationCandidate, result: CustomerConfirmationSweepResult) => {
  const closedAt = new Date().toISOString();
  // Silent on purpose (no push, even outside quiet hours): the last reminder
  // already said it would close, and a notification for something the customer
  // chose not to act on is noise. Broadcasts through the shared helper so open
  // order screens update.
  const applied = await updateDeliveredOrderIfNull(order.id, ['customerConfirmedAt', 'customerIssueReportedAt'], {
    customerConfirmationSource: 'auto',
    customerConfirmedAt: closedAt,
    updatedAt: closedAt,
  });

  if (applied) {
    result.autoClosed += 1;
  } else {
    // The customer confirmed or reported between the read and the write.
    result.skipped += 1;
  }
};

/**
 * Runs the sweep. Safe to call as often as you like: each reminder stage goes
 * out at most once per order, and an order closes at most once.
 */
export const sweepCustomerConfirmations = async (
  now: Date = new Date()
): Promise<CustomerConfirmationSweepResult> => {
  const result: CustomerConfirmationSweepResult = { autoClosed: 0, reminded: 0, skipped: 0 };

  let candidates: ConfirmationCandidate[] = [];
  try {
    const { data, error } = await serviceClient
      .from('CustomerOrder')
      .select(CONFIRMATION_SWEEP_COLUMNS)
      .eq('status', ORDER_STATUS.DELIVERED)
      .not('customerConfirmDueAt', 'is', null)
      .is('customerConfirmedAt', null)
      .is('customerIssueReportedAt', null)
      .order('customerConfirmDueAt', { ascending: true })
      .limit(CONFIRMATION_SWEEP_LIMIT);

    if (error) {
      throw new Error(error.message);
    }
    candidates = (data ?? []) as ConfirmationCandidate[];
  } catch (error) {
    logEdgeEvent('error', 'customer confirmation candidate lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  for (const order of candidates) {
    try {
      // Defensive: the query pre-filters, but never act on a row that is not
      // actually waiting, or that has been reported (the timer is stopped).
      if (!isAwaitingCustomerConfirmation(order) || order.customerIssueReportedAt) {
        result.skipped += 1;
        continue;
      }

      const dueAtMs = Date.parse(order.customerConfirmDueAt as string);
      if (!Number.isFinite(dueAtMs)) {
        result.skipped += 1;
        continue;
      }

      if (now.getTime() >= dueAtMs) {
        await autoCloseOrder(order, result);
        continue;
      }

      const stage = getReminderDecision({
        dueAt: order.customerConfirmDueAt,
        now,
        remindersSent: order.customerConfirmRemindersSent ?? 0,
      });
      if (stage === null) {
        result.skipped += 1;
        continue;
      }

      await sendReminder(order, stage, result);
    } catch (error) {
      // One bad order must not abort the batch.
      result.skipped += 1;
      logEdgeEvent('error', 'customer confirmation sweep failed for order', {
        error: error instanceof Error ? error.message : String(error),
        orderId: order.id,
      });
    }
  }

  return result;
};
