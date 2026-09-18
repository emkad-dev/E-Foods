import { useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import RangePicker from '../components/RangePicker';
import StatusBadge from '../components/StatusBadge';
import { useSnapshot } from '../contexts/SnapshotContext';
import { getOrderDate, type RangeDays } from '../lib/analytics';
import { formatCurrency, formatDateTime, formatNumber, humanizeStatus } from '../lib/format';
import { resolveViewState } from '../lib/viewState';
import { getOrderTone, getPaymentTone } from '../theme/tones';

export default function OrdersPage() {
  const { snapshot, error, hasData, refresh } = useSnapshot();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');

  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();

    for (const order of snapshot.orders) {
      const status = (order.status ?? '').toLowerCase();

      if (status) {
        statuses.add(status);
      }
    }

    return [...statuses].sort();
  }, [snapshot.orders]);

  const paymentOptions = useMemo(() => {
    const statuses = new Set<string>();

    for (const order of snapshot.orders) {
      const status = (order.payment?.status ?? '').toString().toLowerCase();

      if (status) {
        statuses.add(status);
      }
    }

    return [...statuses].sort();
  }, [snapshot.orders]);

  const filteredOrders = useMemo(() => {
    const start = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    return [...snapshot.orders]
      .filter((order) => {
        const created = getOrderDate(order);

        if (!created || created < start) {
          return false;
        }

        if (statusFilter !== 'all' && (order.status ?? '').toLowerCase() !== statusFilter) {
          return false;
        }

        if (
          paymentFilter !== 'all' &&
          (order.payment?.status ?? '').toString().toLowerCase() !== paymentFilter
        ) {
          return false;
        }

        return true;
      })
      .sort((left, right) => (getOrderDate(right)?.getTime() ?? 0) - (getOrderDate(left)?.getTime() ?? 0));
  }, [snapshot.orders, rangeDays, statusFilter, paymentFilter]);

  const totalValue = useMemo(
    () => filteredOrders.reduce((total, order) => total + (order.pricing?.total ?? 0), 0),
    [filteredOrders]
  );

  const currency = filteredOrders.find((order) => order.pricing?.currency)?.pricing?.currency ?? 'NGN';

  // The `hasData &&` guards below stopped the console *claiming* "no orders"
  // after a failed fetch, but the other half of the claim was never closed:
  // both false branches fell through to the table, so a failed fetch drew a
  // full header row with nothing under it -- which is the same sentence, only
  // spelled in table furniture. resolveViewState names the fourth outcome, so
  // 'error' can render nothing at all and leave the banner to speak.
  const ordersState = resolveViewState({
    hasData,
    error,
    isEmpty: filteredOrders.length === 0,
  });

  return (
    <div className="page">
      <div className="page-header">
        <div className="filters-row">
          <RangePicker value={rangeDays} onChange={setRangeDays} />
          <select
            className="select-pill"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Status filter"
          >
            <option value="all">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {humanizeStatus(status)}
              </option>
            ))}
          </select>
          <select
            className="select-pill"
            value={paymentFilter}
            onChange={(event) => setPaymentFilter(event.target.value)}
            aria-label="Payment filter"
          >
            <option value="all">All payments</option>
            {paymentOptions.map((status) => (
              <option key={status} value={status}>
                {humanizeStatus(status)}
              </option>
            ))}
          </select>
        </div>
        {/* A count and a money total are claims about the business, so they may
            only be made about data that actually arrived. Ungated, this read
            "0 orders · NGN 0" during every load and permanently after a failed
            fetch, because SnapshotContext keeps its EMPTY_SNAPSHOT on the catch
            path. Same defect the three dashboard screens had. */}
        {hasData ? (
          <div className="muted">
            {formatNumber(filteredOrders.length)} orders · {formatCurrency(totalValue, currency)}
          </div>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

      <div className="card">
        {/* The skeleton belongs INSIDE the card, in place of the table. As a
            sibling above it, a first load painted shimmer bars and a complete
            empty table at the same time: two loading metaphors, one of which
            reads as an answer. */}
        {ordersState === 'loading' ? <SkeletonRows count={8} /> : null}
        {ordersState === 'empty' ? (
          <EmptyState title="No orders in this window" body="Try a wider date range or a different status filter." />
        ) : null}
        {ordersState === 'ready' ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order id</th>
                  <th>Restaurant</th>
                  <th>Fulfillment</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Date &amp; time</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td className="cell-strong">#{String(order.id).slice(-8).toUpperCase()}</td>
                    <td>{order.restaurantName || 'Unknown restaurant'}</td>
                    <td className="muted">{humanizeStatus(order.fulfillmentType)}</td>
                    <td>
                      <StatusBadge label={order.status} tone={getOrderTone(order.status)} />
                      {/* An escalated order stays `placed` -- the acceptance
                          sweep raises this flag instead of moving the status,
                          so `status` alone cannot tell the operator that the
                          restaurant's clock already ran out. The snapshot has
                          carried the flag all along and nothing read it. */}
                      {order.needsAttention === true ? (
                        <span className="badge badge-warning" title="Past its acceptance deadline and escalated.">
                          Needs attention
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge
                        label={order.payment?.status ?? 'unknown'}
                        tone={getPaymentTone(order.payment?.status?.toString())}
                      />
                    </td>
                    <td className="muted">{formatDateTime(order.createdAt)}</td>
                    <td className="cell-amount">
                      {formatCurrency(order.pricing?.total ?? 0, order.pricing?.currency ?? currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
