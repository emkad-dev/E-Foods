import { useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import RangePicker from '../components/RangePicker';
import StatusBadge from '../components/StatusBadge';
import { useSnapshot } from '../contexts/SnapshotContext';
import { getOrderDate, type RangeDays } from '../lib/analytics';
import { formatCurrency, formatDateTime, formatNumber, humanizeStatus } from '../lib/format';
import { getOrderTone } from '../theme/tones';

export default function OrdersPage() {
  const { snapshot, loading, error, refresh } = useSnapshot();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [statusFilter, setStatusFilter] = useState<string>('all');

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

        return true;
      })
      .sort((left, right) => (getOrderDate(right)?.getTime() ?? 0) - (getOrderDate(left)?.getTime() ?? 0));
  }, [snapshot.orders, rangeDays, statusFilter]);

  const totalValue = useMemo(
    () => filteredOrders.reduce((total, order) => total + (order.pricing?.total ?? 0), 0),
    [filteredOrders]
  );

  const currency = filteredOrders.find((order) => order.pricing?.currency)?.pricing?.currency ?? 'NGN';

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
        </div>
        <div className="muted">
          {formatNumber(filteredOrders.length)} orders · {formatCurrency(totalValue, currency)}
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {loading ? <LoadingBlock label="Loading orders…" /> : null}

      <div className="card">
        {filteredOrders.length === 0 && !loading ? (
          <EmptyState title="No orders in this window" body="Try a wider date range or a different status filter." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
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
                    </td>
                    <td className="muted">{humanizeStatus(order.payment?.status ?? 'unknown')}</td>
                    <td className="muted">{formatDateTime(order.createdAt)}</td>
                    <td className="cell-amount">
                      {formatCurrency(order.pricing?.total ?? 0, order.pricing?.currency ?? currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
