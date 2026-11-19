import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ADMIN_ORDER_NOTE_MAX_LENGTH,
  canAdminForceCancelOrder,
  canAdminForceCompleteOrder,
  canAdminResolveOrderReport,
} from '../../../../packages/domain/src/adminOrders';
import { hasCapturedPayment } from '../../../../packages/domain/src/orders';
import {
  assessPaystackRefund,
  canMarkRefundedManually,
  describeRefundExecutionStatus,
  readRefundExecution,
} from '../../../../packages/domain/src/refundExecution';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { useSnapshot } from '../contexts/SnapshotContext';
import { formatCurrency, formatDateTime, humanizeStatus } from '../lib/format';
import { resolveViewState } from '../lib/viewState';
import { describeWriteFailure } from '../lib/writeOutcome';
import {
  forceCancelAdminOrder,
  forceCompleteAdminOrder,
  getAdminOrderDetail,
  resolveAdminOrderReport,
  sendAdminOrderRefund,
  type AdminOrderDetail,
} from '../services/platformReads';
import { getOrderTone, getPaymentTone } from '../theme/tones';

/**
 * ADMIN ORDER DRILL-DOWN.
 *
 * The orders table is fed by the dashboard snapshot, which deliberately drops
 * cancelled / rejected / failed-delivery and unpaid prepaid orders, so those
 * were invisible to admin. This page reads one order by id through
 * adminGetOrderDetail, which applies no such filter -- it is the only place a
 * failed order can be inspected.
 *
 * It is also the admin's way out for a stuck order: force-cancel, force-complete
 * and marking any flagged order resolved (which also closes an open customer
 * problem report). Each button shows only when the
 * server would accept the action (the rules are shared with it through
 * packages/domain/src/adminOrders.ts), and each asks for a reason in an in-page
 * dialog before anything is sent.
 */

type InterventionKind = 'cancel' | 'complete' | 'resolve' | 'refund' | 'mark_manual';

const INTERVENTION_COPY: Record<
  InterventionKind,
  { busyLabel: string; buttonLabel: string; confirmLabel: string; fieldLabel: string; title: string }
> = {
  cancel: {
    busyLabel: 'Cancelling…',
    buttonLabel: 'Force cancel',
    confirmLabel: 'Cancel this order',
    fieldLabel: 'Reason',
    title: 'Force cancel this order?',
  },
  complete: {
    busyLabel: 'Completing…',
    buttonLabel: 'Force complete',
    confirmLabel: 'Mark completed',
    fieldLabel: 'Reason',
    title: 'Mark this order completed?',
  },
  resolve: {
    busyLabel: 'Resolving…',
    buttonLabel: 'Mark resolved',
    confirmLabel: 'Mark resolved',
    fieldLabel: 'Resolution note',
    title: 'Mark this order resolved?',
  },
  refund: {
    busyLabel: 'Sending…',
    // The amount is added where the button renders.
    buttonLabel: 'Refund via Paystack',
    confirmLabel: 'Send the refund',
    fieldLabel: 'Note',
    title: 'Refund via Paystack?',
  },
  mark_manual: {
    busyLabel: 'Saving…',
    buttonLabel: 'I refunded this by hand',
    confirmLabel: 'Mark refunded',
    fieldLabel: 'How it was refunded',
    title: 'Mark this refund as paid by hand?',
  },
};

/** The server's mark_manual rule: a recorded, captured refund with nothing in flight at Paystack. */
const canMarkManual = (order: AdminOrderDetail) =>
  order.payment?.status === 'refunded' &&
  hasCapturedPayment(order.payment) &&
  canMarkRefundedManually(readRefundExecution(order.payment));

/**
 * The refund the server would send now, or null when the button must not show.
 * resume: a stale or unconfirmed attempt resent with its own reference.
 */
const sendableRefundOf = (order: AdminOrderDetail) => {
  const eligibility = assessPaystackRefund(order.payment, hasCapturedPayment(order.payment), {
    allowUnconfirmed: true,
    nowMs: Date.now(),
  });
  return eligibility.ok ? { amount: eligibility.amount, resume: eligibility.resume } : null;
};
const sendableRefund = (order: AdminOrderDetail) => sendableRefundOf(order)?.amount ?? null;

/** What the dialog says will happen, before the admin commits. */
const describeIntervention = (kind: InterventionKind, order: AdminOrderDetail, currency: string) => {
  if (kind === 'cancel') {
    return order.payment?.status === 'paid'
      ? `The customer paid. A full refund of ${formatCurrency(
          Number(order.payment.capturedAmount ?? order.total),
          currency
        )} will be recorded on the order and it will be flagged for attention. No money moves yet. Use Refund via Paystack on the order page, or mark it refunded by hand there. The customer and the restaurant are told the order was cancelled.`
      : 'No payment was captured, so nothing is refunded. The customer and the restaurant are told the order was cancelled.';
  }
  if (kind === 'refund') {
    const amount = formatCurrency(sendableRefund(order) ?? 0, currency);
    const customer = order.customer.displayName ?? order.customer.email ?? order.customer.uid;
    const lastAttempt = readRefundExecution(order.payment);
    const retryNote =
      lastAttempt?.status === 'failed'
        ? ` The last attempt failed${lastAttempt.lastError ? `: ${lastAttempt.lastError}` : ''}. Nothing left FEASTY for it.`
        : sendableRefundOf(order)?.resume
          ? ' The last attempt was never confirmed. It is resent with the same Paystack reference, so Paystack refuses it if the first one already went through.'
          : '';
    return `${amount} goes back to ${customer} through Paystack. It is paid from FEASTY's Paystack balance (pending payouts first), not by the restaurant, and it cannot be undone once sent. Paystack keeps its original transaction fee.${retryNote}`;
  }
  if (kind === 'mark_manual') {
    const amount = formatCurrency(Number(order.payment?.refundAmount ?? 0), currency);
    return `Use this only when ${amount} has already reached the customer outside FEASTY (from the Paystack dashboard or by bank transfer). FEASTY will never send a Paystack refund for this order afterwards, the attention flag is cleared, and the customer gets no message. Check Paystack first.`;
  }
  if (kind === 'complete') {
    return 'The order is marked delivered. The customer gets 3 hours to confirm they received it or report a problem, and the restaurant is told FEASTY support completed it.';
  }
  // Mirrors the server: only an open customer-report flow is closed.
  const closesConfirmation = Boolean(
    order.customerIssueReportedAt && order.status === 'delivered' && order.customerConfirmDueAt && !order.customerConfirmedAt
  );
  return closesConfirmation
    ? 'The attention flag is cleared and the customer confirmation is closed the way the 3-hour auto-close does. The order status does not change.'
    : 'The attention flag is cleared. The order status does not change.';
};

const dash = (value: ReactNode) => (value === null || value === undefined || value === '' ? '—' : value);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="audit-detail-field">
      <dt className="muted">{label}</dt>
      <dd className="audit-detail-value">{dash(children)}</dd>
    </div>
  );
}

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

export default function OrderDetailPage() {
  const { orderId = '' } = useParams<{ orderId: string }>();
  const { refresh: refreshSnapshot } = useSnapshot();
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<InterventionKind | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await getAdminOrderDetail(orderId);
      setOrder(response.order);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load this order right now.');
    }
  }, [orderId]);

  useEffect(() => {
    // A different order id must never show the previous order's data under the
    // new heading while its own read is in flight.
    setOrder(null);
    setError(null);
    setPendingAction(null);
    setActionError(null);
    setActionNotice(null);
    void load();
  }, [load]);

  const openAction = (kind: InterventionKind) => {
    setPendingAction(kind);
    setActionNote('');
    setActionError(null);
    setActionNotice(null);
  };

  const runAction = async () => {
    const note = actionNote.trim();
    if (!order || !pendingAction || !note) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      if (pendingAction === 'cancel') {
        const result = await forceCancelAdminOrder({ orderId: order.id, reason: note });
        setActionNotice(
          result.refundRecorded
            ? 'Order cancelled. A full refund is recorded and the order is flagged: no money has moved yet. Use Refund via Paystack on the order page, or mark it refunded by hand there.'
            : 'Order cancelled. No payment was captured, so nothing was refunded.'
        );
      } else if (pendingAction === 'refund') {
        const result = await sendAdminOrderRefund({ orderId: order.id, note });
        const execution = readRefundExecution({ refundExecution: result.refundExecution });
        setActionNotice(
          result.outcome === 'sent'
            ? `Refund sent to Paystack (${describeRefundExecutionStatus(execution?.status ?? 'requested').toLowerCase()}). The customer is told when Paystack finishes it.`
            : result.outcome === 'failed'
              ? `Paystack refused the refund${execution?.lastError ? `: ${execution.lastError}` : ''}. Nothing was sent, so you can try again.`
              : result.outcome === 'blocked'
                ? 'Paystack already holds a refund on this payment that FEASTY did not send, so nothing was sent. Check Paystack; if the customer was refunded, mark it refunded by hand.'
                : 'Paystack did not confirm the refund. Check the Paystack dashboard before trying again or marking it refunded by hand.'
        );
      } else if (pendingAction === 'mark_manual') {
        await sendAdminOrderRefund({ mode: 'mark_manual', orderId: order.id, note });
        setActionNotice('Marked refunded by hand. FEASTY will not send a Paystack refund for this order.');
      } else if (pendingAction === 'complete') {
        await forceCompleteAdminOrder({ orderId: order.id, reason: note });
        setActionNotice('Order marked completed. The customer has 3 hours to confirm it or report a problem.');
      } else {
        const result = await resolveAdminOrderReport({ orderId: order.id, note });
        setActionNotice(
          result.customerConfirmedAt && !order.customerConfirmedAt
            ? 'Marked resolved. The attention flag is cleared and the customer confirmation is closed.'
            : 'Marked resolved. The attention flag is cleared.'
        );
      }
      setPendingAction(null);
    } catch (nextError) {
      // The server's own message: a 409 says the order changed meanwhile, a 412
      // says why the action no longer applies. The dialog stays open with the
      // typed reason so the admin can retry or back out without retyping it.
      setActionError(
        await describeWriteFailure(nextError, {
          fallback: 'The action failed. Reload the order and try again.',
          // The finally block below reloads the order and the snapshot on
          // every outcome, so there is nothing extra to reload here.
          reload: () => undefined,
        })
      );
    } finally {
      setActionBusy(false);
      // Success or failure, show the order as it now stands -- here and in the
      // Orders list and Overview, which read the shared snapshot. Without the
      // snapshot refresh, "Back to orders" showed the old status for up to the
      // full poll interval, so the action looked like it had not happened.
      void load();
      void refreshSnapshot();
    }
  };

  const closeAction = () => {
    setPendingAction(null);
    setActionError(null);
  };

  const viewState = resolveViewState({ hasData: order !== null, error });
  const currency = order?.pricing?.currency ?? 'NGN';
  const availableActions: InterventionKind[] = order
    ? [
        ...(canAdminForceCompleteOrder(order) ? (['complete'] as const) : []),
        ...(canAdminResolveOrderReport(order) ? (['resolve'] as const) : []),
        ...(sendableRefund(order) !== null ? (['refund'] as const) : []),
        ...(canMarkManual(order) ? (['mark_manual'] as const) : []),
        ...(canAdminForceCancelOrder(order) ? (['cancel'] as const) : []),
      ]
    : [];
  const refundAmount = order ? sendableRefund(order) : null;
  const refundExecution = order ? readRefundExecution(order.payment) : null;

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/orders" className="btn btn-ghost btn-sm">
          ← Back to orders
        </Link>
        {order ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            Refresh
          </button>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {order && pendingAction ? (
        <ConfirmDialog
          title={INTERVENTION_COPY[pendingAction].title}
          body={
            <>
              <p>{describeIntervention(pendingAction, order, currency)}</p>
              {actionError ? <ErrorBanner message={actionError} /> : null}
              <div className="field">
                <label htmlFor="order-action-note">{INTERVENTION_COPY[pendingAction].fieldLabel}</label>
                <textarea
                  id="order-action-note"
                  rows={3}
                  maxLength={ADMIN_ORDER_NOTE_MAX_LENGTH}
                  value={actionNote}
                  aria-describedby="order-action-note-hint"
                  onChange={(event) => setActionNote(event.target.value)}
                />
                <span id="order-action-note-hint" className="muted" style={{ fontSize: 12 }}>
                  Recorded in the audit log and visible to FEASTY staff and the assigned dispatcher.
                </span>
              </div>
            </>
          }
          busy={actionBusy}
          busyLabel={INTERVENTION_COPY[pendingAction].busyLabel}
          cancelLabel="Back"
          confirmDisabled={actionNote.trim() === ''}
          confirmLabel={INTERVENTION_COPY[pendingAction].confirmLabel}
          onCancel={closeAction}
          onConfirm={() => void runAction()}
        />
      ) : null}
      {viewState === 'loading' ? <LoadingBlock label="Loading order..." /> : null}
      {viewState === 'error' && !order ? (
        <div className="card">
          <EmptyState
            title="This order could not be loaded"
            body={`The read for order ${orderId} failed, so nothing can be said about it yet. Retry from the banner above.`}
          />
        </div>
      ) : null}

      {order ? (
        <div className="section-stack">
          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Order #{order.id.slice(-8).toUpperCase()}</h3>
              <span>
                <StatusBadge label={order.status} tone={getOrderTone(order.status)} />
                {order.needsAttention ? (
                  <span className="badge badge-warning" title="Flagged for an admin. The timeline and alerts say why.">
                    Needs attention
                  </span>
                ) : null}
              </span>
            </div>
            {actionNotice ? (
              <p role="status" style={{ color: 'var(--accent-strong)', fontWeight: 600, marginTop: 0 }}>
                {actionNotice}
              </p>
            ) : null}
            {availableActions.length > 0 ? (
              <div className="filters-row" style={{ marginBottom: 14 }}>
                {availableActions.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={kind === 'cancel' ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-ghost'}
                    disabled={actionBusy}
                    onClick={() => openAction(kind)}
                  >
                    {kind === 'refund' && refundAmount !== null
                      ? `${order && sendableRefundOf(order)?.resume ? 'Resend via Paystack' : INTERVENTION_COPY.refund.buttonLabel} (${formatCurrency(refundAmount, currency)})`
                      : INTERVENTION_COPY[kind].buttonLabel}
                  </button>
                ))}
              </div>
            ) : null}
            <dl className="audit-detail-grid">
              <Field label="Order id">{order.id}</Field>
              <Field label="Restaurant">{order.restaurantName}</Field>
              <Field label="Fulfillment">{humanizeStatus(order.fulfillmentType)}</Field>
              <Field label="Placed">{formatDateTime(order.createdAt)}</Field>
              <Field label="Last updated">{formatDateTime(order.updatedAt)}</Field>
              {order.scheduledFor ? <Field label="Scheduled for">{formatDateTime(order.scheduledFor)}</Field> : null}
              <Field label="Delivery address">{order.deliveryAddress}</Field>
              <Field label="Order group">{order.orderGroupId}</Field>
              {order.customerIssueReportedAt ? (
                <Field label="Problem reported">{formatDateTime(order.customerIssueReportedAt)}</Field>
              ) : null}
              {order.customerConfirmDueAt ? (
                <Field label="Customer confirmation">
                  {order.customerConfirmedAt
                    ? `${order.customerConfirmationSource === 'auto' ? 'Closed' : 'Confirmed'} ${formatDateTime(
                        order.customerConfirmedAt
                      )}`
                    : `Waiting until ${formatDateTime(order.customerConfirmDueAt)}`}
                </Field>
              ) : null}
              <Field label="Delivery code verified">
                {order.deliveryCodeVerifiedAt
                  ? formatDateTime(order.deliveryCodeVerifiedAt)
                  : `No (${order.deliveryCodeAttempts} failed attempts)`}
              </Field>
            </dl>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Customer and courier</h3>
            </div>
            <dl className="audit-detail-grid">
              <Field label="Customer">{order.customer.displayName}</Field>
              <Field label="Email">{order.customer.email}</Field>
              <Field label="Phone">{order.customer.phoneNumber}</Field>
              <Field label="Customer uid">{order.customer.uid}</Field>
              <Field label="Courier">{order.assignment?.courierName}</Field>
              <Field label="Courier uid">{order.assignment?.courierId}</Field>
            </dl>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Items</h3>
            </div>
            {order.items.length === 0 ? (
              <EmptyState title="No line items" body="This order has no item rows recorded." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Options</th>
                      <th>Qty</th>
                      <th>Unit price</th>
                      <th>Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item, index) => (
                      <tr key={`${item.id}-${index}`}>
                        <td className="cell-strong">{item.name}</td>
                        <td className="muted">
                          {item.selectedOptions.length > 0
                            ? item.selectedOptions
                                .map((option) => stringify(option.name ?? option.label ?? option))
                                .join(', ')
                            : '—'}
                        </td>
                        <td>{item.quantity}</td>
                        <td>{formatCurrency(item.price + item.optionDelta, currency)}</td>
                        <td className="cell-amount">
                          {formatCurrency((item.price + item.optionDelta) * item.quantity, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <dl className="audit-detail-grid" style={{ marginTop: 14 }}>
              <Field label="Subtotal">{formatCurrency(order.pricing?.subtotal ?? 0, currency)}</Field>
              <Field label="Delivery fee">{formatCurrency(order.pricing?.deliveryFee ?? 0, currency)}</Field>
              <Field label="Service fee">{formatCurrency(order.pricing?.serviceFee ?? 0, currency)}</Field>
              <Field label="Tip">{formatCurrency(order.pricing?.tip ?? 0, currency)}</Field>
              <Field label="Discount">{formatCurrency(order.pricing?.discount ?? 0, currency)}</Field>
              <Field label="Total">{formatCurrency(order.total, currency)}</Field>
            </dl>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Payments</h3>
              <span className="muted">
                Order payment: {humanizeStatus(stringify(order.payment.method))} ·{' '}
                {humanizeStatus(stringify(order.payment.status))}
              </span>
            </div>
            {refundExecution ? (
              <dl className="audit-detail-grid" style={{ marginBottom: 14 }}>
                <Field label="Paystack refund">
                  <StatusBadge
                    label={describeRefundExecutionStatus(refundExecution.status)}
                    tone={
                      refundExecution.status === 'processed'
                        ? 'success'
                        : refundExecution.status === 'failed' || refundExecution.status === 'needs_attention'
                          ? 'danger'
                          : 'warning'
                    }
                  />
                </Field>
                <Field label="Refund amount sent">
                  {refundExecution.amount !== null ? formatCurrency(refundExecution.amount, currency) : null}
                </Field>
                <Field label="Requested">
                  {refundExecution.requestedAt
                    ? `${formatDateTime(refundExecution.requestedAt)} by ${
                        refundExecution.requestedBy === 'auto' ? 'automatic refund' : 'an admin'
                      } (attempt ${refundExecution.attempt})`
                    : null}
                </Field>
                {refundExecution.processedAt ? (
                  <Field label="Processed">{formatDateTime(refundExecution.processedAt)}</Field>
                ) : null}
                {refundExecution.failedAt ? <Field label="Failed">{formatDateTime(refundExecution.failedAt)}</Field> : null}
                {refundExecution.lastError ? <Field label="Reason">{refundExecution.lastError}</Field> : null}
                {refundExecution.manual ? <Field label="Refunded">By hand, outside FEASTY</Field> : null}
                <Field label="Refund reference">{refundExecution.reference}</Field>
              </dl>
            ) : null}
            {order.payments.length === 0 ? (
              <EmptyState
                title="No payment transactions"
                body="No gateway transaction was recorded for this order (for example cash on delivery, or a checkout that never reached the gateway)."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Status</th>
                      <th>Amount</th>
                      <th>Settlement</th>
                      <th>Channel</th>
                      <th>Created</th>
                      <th>Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="cell-strong">{payment.reference}</td>
                        <td>
                          <StatusBadge label={payment.status} tone={getPaymentTone(payment.status)} />
                        </td>
                        <td className="cell-amount">{formatCurrency(payment.amount, payment.currency ?? currency)}</td>
                        <td className="muted">{payment.settlementMode ? humanizeStatus(payment.settlementMode) : '—'}</td>
                        <td className="muted">{payment.channel ? humanizeStatus(payment.channel) : '—'}</td>
                        <td className="muted">{formatDateTime(payment.createdAt)}</td>
                        <td className="muted">{payment.lastError ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {order.cancellation && Object.keys(order.cancellation).length > 0 ? (
            <div className="card">
              <div className="card-title-row">
                <h3 className="card-title">Cancellation</h3>
              </div>
              <dl className="audit-detail-grid">
                {Object.entries(order.cancellation).map(([key, value]) => (
                  <Field key={key} label={humanizeStatus(key)}>
                    {stringify(value)}
                  </Field>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Event timeline</h3>
            </div>
            {order.events.length === 0 ? (
              <EmptyState title="No events recorded" body="No delivery events have been logged for this order." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Event</th>
                      <th>Actor</th>
                      <th>Note</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.events.map((event) => (
                      <tr key={event.id}>
                        <td className="muted">{formatDateTime(event.createdAt)}</td>
                        <td className="cell-strong">{humanizeStatus(event.eventType)}</td>
                        <td className="muted">{event.actorUid ?? 'System'}</td>
                        <td>{event.note ?? '—'}</td>
                        <td className="muted">{event.details ? stringify(event.details) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
