// adminSendOrderRefund - the admin's "Refund via Paystack" on an order whose
// refund is recorded but not yet sent (or whose last Paystack attempt failed).
// Money leaves FEASTY's Paystack balance, so: admin only, a note required, and
// sendOrderRefund's compare-and-set means a double click or an automatic
// refund racing this click sends one refund at most (the loser gets 409).
//
// mode 'mark_manual' ("I refunded this by hand"): the admin returned the money
// outside FEASTY. No Paystack call; the execution becomes processed + manual,
// which blocks any later Paystack refund of the order. Audited the same way.
//
// Every attempt that reached Paystack (sent, refused by Paystack, blocked by a
// refund already there, or unconfirmed) is audited: an AdminAuditLog entry and an order timeline event
// carrying the admin's note. Both best-effort, after the money call, so a
// failed audit write never turns a sent refund into an error the admin would
// retry.

import { parseAdminOrderNote } from './adminOrderInterventions.ts';
import { createAuditEntry } from './auditLog.ts';
import { logEdgeEvent } from './observability.ts';
import { insertDeliveryEvent } from './orders.ts';
import { markOrderRefundedManually, sendOrderRefund } from './paystackRefund.ts';
import { sanitizeText } from './rpc/coercion.ts';
import { ensureRole, type AuthenticatedRequestContext } from './rpc/context.ts';
import type { RpcHandler } from './rpc/registry.ts';
import { fail, json } from './rpc/respond.ts';

type Handler = RpcHandler<AuthenticatedRequestContext>;

const REFUSAL_MESSAGES: Record<string, string> = {
  already_started: 'A Paystack refund for this order has already been started. Reload the order to see its status.',
  no_amount: 'No refund amount is recorded on this order, so there is nothing to send.',
  no_reference: 'This order has no Paystack transaction reference, so Paystack cannot refund it. Refund it by hand.',
  not_captured: 'No payment was captured for this order, so there is nothing to refund.',
  not_paystack: 'This order was not paid through Paystack, so it cannot be refunded there.',
  not_recorded: 'No refund is recorded on this order yet. Cancel or close it first so the refund is recorded.',
  over_cap: 'The recorded refund is more than this order captured, so it was not sent. Check the payment by hand.',
};

export const adminSendOrderRefund: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['admin']);
  const orderId = sanitizeText(data.orderId);
  if (!orderId || orderId.length > 128) {
    fail(400, 'An order id is required.');
  }
  const note = parseAdminOrderNote(data.note, 'note');
  const mode = sanitizeText(data.mode, 'paystack');
  if (mode !== 'paystack' && mode !== 'mark_manual') {
    fail(400, 'Unknown refund mode.');
  }

  if (mode === 'mark_manual') {
    const marked = await markOrderRefundedManually({ adminUid: context.uid, orderId });
    if (marked.kind === 'not_found') fail(404, 'Order not found.');
    if (marked.kind === 'refused') {
      fail(
        412,
        marked.reason === 'already_started'
          ? 'A Paystack refund for this order is in progress or done, so it cannot be marked refunded by hand.'
          : (REFUSAL_MESSAGES[marked.reason] ?? 'This order cannot be marked refunded.')
      );
    }
    if (marked.kind === 'changed') {
      fail(409, 'This order changed while you were saving. Reload the order and check before trying again.');
    }
    const execution = marked.kind === 'marked' ? marked.execution : null;
    await recordRefundTrail(context.uid, orderId, note, 'admin_refund_marked_manual', 'order_refund_marked_manual', {
      amount: execution?.amount ?? null,
      outcome: 'marked_manual',
    });
    return json(200, { data: { orderId, outcome: 'marked_manual', refundExecution: execution } });
  }

  const result = await sendOrderRefund({ orderId, requestedBy: `admin:${context.uid}` });

  if (result.kind === 'not_found') {
    fail(404, 'Order not found.');
  }
  if (result.kind === 'refused') {
    fail(412, REFUSAL_MESSAGES[result.reason] ?? 'This order cannot be refunded through Paystack.');
  }
  if (result.kind === 'changed') {
    fail(409, 'This order changed, or a refund was started for it, while you were sending. Reload the order and check before trying again.');
  }
  if (result.kind !== 'sent' && result.kind !== 'failed' && result.kind !== 'unconfirmed' && result.kind !== 'blocked') {
    fail(500, 'Unexpected refund outcome.');
  }

  const execution = 'execution' in result ? result.execution : null;
  const details = {
    amount: execution?.amount ?? null,
    attempt: execution?.attempt ?? null,
    outcome: result.kind,
    paystackRefundId: execution?.paystackRefundId ?? null,
    reference: execution?.reference ?? null,
    status: execution?.status ?? null,
  };
  await recordRefundTrail(context.uid, orderId, note, 'admin_refund_sent', 'order_refund_sent', details);

  return json(200, { data: { orderId, outcome: result.kind, refundExecution: execution } });
};

const recordRefundTrail = async (
  actorUid: string,
  orderId: string,
  note: string,
  eventType: string,
  auditAction: string,
  details: Record<string, unknown>
) => {
  try {
    await insertDeliveryEvent({ actorUid, details, eventType, note, orderId });
  } catch (error) {
    logEdgeEvent('error', 'admin refund event write failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
  }
  try {
    await createAuditEntry(actorUid, auditAction, 'order', orderId, { ...details, note });
  } catch (error) {
    logEdgeEvent('error', 'admin refund audit write failed', {
      error: error instanceof Error ? error.message : String(error),
      orderId,
    });
  }
};
