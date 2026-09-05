import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BreakdownCard from '../components/BreakdownCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import KpiCard from '../components/KpiCard';
import { SkeletonRows } from '../components/Skeleton';
import RangePicker from '../components/RangePicker';
import StatusBadge from '../components/StatusBadge';
import { useSnapshot } from '../contexts/SnapshotContext';
import {
  buildPaymentBreakdown,
  buildStatusBreakdown,
  computeDashboardKpis,
  computeProblemCounts,
  getOrderDate,
  type RangeDays,
} from '../lib/analytics';
import { formatCurrency, formatDateTime, formatNumber } from '../lib/format';
import { getApprovalTone, getOrderTone, getPaymentChartColor, getStatusChartColor } from '../theme/tones';

export default function OverviewPage() {
  const { snapshot, loading, error, refresh } = useSnapshot();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  const kpis = useMemo(
    () =>
      computeDashboardKpis(snapshot.orders, snapshot.users, snapshot.restaurants, snapshot.dispatchProfiles, rangeDays),
    [snapshot, rangeDays]
  );

  const recentOrders = useMemo(
    () =>
      [...snapshot.orders]
        .sort((left, right) => (getOrderDate(right)?.getTime() ?? 0) - (getOrderDate(left)?.getTime() ?? 0))
        .slice(0, 8),
    [snapshot.orders]
  );

  const statusBreakdown = useMemo(() => buildStatusBreakdown(snapshot.orders).slice(0, 8), [snapshot.orders]);

  const windowedOrders = useMemo(() => {
    const start = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    return snapshot.orders.filter((order) => {
      const created = getOrderDate(order);
      return created !== null && created >= start;
    });
  }, [snapshot.orders, rangeDays]);

  const problemCounts = useMemo(() => computeProblemCounts(windowedOrders), [windowedOrders]);
  const paymentBreakdown = useMemo(() => buildPaymentBreakdown(snapshot.orders).slice(0, 8), [snapshot.orders]);

  const approvalPulse = useMemo(
    () =>
      snapshot.restaurants
        .filter((restaurant) => restaurant.isPublished !== true)
        .slice(0, 5),
    [snapshot.restaurants]
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="filters-row">
          <RangePicker value={rangeDays} onChange={setRangeDays} />
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {loading ? <SkeletonRows count={4} /> : null}

      <div className="kpi-grid">
        <KpiCard
          label={`Orders (${rangeDays}d)`}
          value={formatNumber(kpis.orders.current)}
          current={kpis.orders.current}
          previous={kpis.orders.previous}
        />
        <KpiCard
          label={`Revenue (${rangeDays}d)`}
          value={formatCurrency(kpis.revenue.current, kpis.currency)}
          current={kpis.revenue.current}
          previous={kpis.revenue.previous}
        />
        <KpiCard
          label={`New users (${rangeDays}d)`}
          value={formatNumber(kpis.newUsers.current)}
          current={kpis.newUsers.current}
          previous={kpis.newUsers.previous}
        />
        <KpiCard label="Live orders" value={formatNumber(kpis.liveOrders)} />
        <KpiCard label="Dispatch online" value={formatNumber(kpis.dispatchOnline)} />
        <KpiCard label="Pending approvals" value={formatNumber(kpis.pendingApprovals)} />
        <KpiCard label={`Failed payments (${rangeDays}d)`} value={formatNumber(problemCounts.failedPayments)} />
        <KpiCard label={`Pending payments (${rangeDays}d)`} value={formatNumber(problemCounts.pendingPayments)} />
        <KpiCard label={`Cancelled orders (${rangeDays}d)`} value={formatNumber(problemCounts.cancelledOrders)} />
      </div>

      <div className="grid-2">
        <div className="section-stack">
          <BreakdownCard
            title="Orders by status"
            moreHref="/statistics"
            slices={statusBreakdown}
            colorFor={getStatusChartColor}
            emptyTitle="No orders yet"
            emptyBody="Order status distribution will appear here."
          />

          <BreakdownCard
            title="Payments by status"
            moreHref="/statistics"
            slices={paymentBreakdown}
            colorFor={getPaymentChartColor}
            emptyTitle="No payments yet"
            emptyBody="Payment status distribution will appear here."
          />

          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Approval pulse</h3>
              <Link to="/approvals" className="muted text-[13px]">
                more →
              </Link>
            </div>
            {approvalPulse.length === 0 ? (
              <EmptyState title="Queue is clear" body="No restaurants are waiting for review." />
            ) : (
              approvalPulse.map((restaurant) => (
                <div key={restaurant.id} className="list-row">
                  <div>
                    <div className="list-row-title">{restaurant.name}</div>
                    <div className="list-row-sub">{restaurant.address ?? 'Address pending'}</div>
                  </div>
                  <StatusBadge
                    label={restaurant.approvalStatus ?? (restaurant.isPublished === true ? 'approved' : 'pending')}
                    tone={getApprovalTone(restaurant.approvalStatus, restaurant.isPublished)}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">Orders history</h3>
            <Link to="/orders" className="muted text-[13px]">
              more →
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <EmptyState title="No orders yet" body="Orders will appear here once customers start checking out." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order id</th>
                    <th>Restaurant</th>
                    <th>Status</th>
                    <th>Date &amp; time</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.id}>
                      <td className="cell-strong">#{String(order.id).slice(-8).toUpperCase()}</td>
                      <td>{order.restaurantName || 'Unknown restaurant'}</td>
                      <td>
                        <StatusBadge label={order.status} tone={getOrderTone(order.status)} />
                      </td>
                      <td className="muted">{formatDateTime(order.createdAt)}</td>
                      <td className="cell-amount">
                        {formatCurrency(order.pricing?.total ?? 0, order.pricing?.currency ?? kpis.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
