import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { formatCurrency, formatDateTime, humanizeStatus } from '../lib/format';
import { resolveViewState } from '../lib/viewState';
import { getAdminOrderDetail, type AdminOrderDetail } from '../services/platformReads';
import { getOrderTone, getPaymentTone } from '../theme/tones';

/**
 * ADMIN ORDER DRILL-DOWN.
 *
 * The orders table is fed by the dashboard snapshot, which deliberately drops
 * cancelled / rejected / failed-delivery and unpaid prepaid orders, so those
 * were invisible to admin. This page reads one order by id through
 * adminGetOrderDetail, which applies no such filter -- it is the only place a
 * failed order can be inspected.
 */

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
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    void load();
  }, [load]);

  const viewState = resolveViewState({ hasData: order !== null, error });
  const currency = order?.pricing?.currency ?? 'NGN';

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
                  <span className="badge badge-warning" title="Past its acceptance deadline and escalated.">
                    Needs attention
                  </span>
                ) : null}
              </span>
            </div>
            <dl className="audit-detail-grid">
              <Field label="Order id">{order.id}</Field>
              <Field label="Restaurant">{order.restaurantName}</Field>
              <Field label="Fulfillment">{humanizeStatus(order.fulfillmentType)}</Field>
              <Field label="Placed">{formatDateTime(order.createdAt)}</Field>
              <Field label="Last updated">{formatDateTime(order.updatedAt)}</Field>
              {order.scheduledFor ? <Field label="Scheduled for">{formatDateTime(order.scheduledFor)}</Field> : null}
              <Field label="Delivery address">{order.deliveryAddress}</Field>
              <Field label="Order group">{order.orderGroupId}</Field>
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
