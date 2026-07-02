import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import KpiCard from '../components/KpiCard';
import LoadingBlock from '../components/LoadingBlock';
import RangePicker from '../components/RangePicker';
import StatusBadge from '../components/StatusBadge';
import { useSnapshot } from '../contexts/SnapshotContext';
import {
  buildStatusBreakdown,
  computeDashboardKpis,
  getOrderDate,
  type RangeDays,
} from '../lib/analytics';
import { formatCurrency, formatDateTime, formatNumber, humanizeStatus } from '../lib/format';
import { getApprovalTone, getOrderTone } from '../theme/tones';

const STATUS_COLORS = ['#18b26b', '#b5e48c', '#f4a261', '#117c6a', '#c54a43', '#5b6978', '#0f7f4c', '#b86f1f'];

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
      {loading ? <LoadingBlock label="Loading the admin overview…" /> : null}

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
      </div>

      <div className="grid-2">
        <div className="section-stack">
          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Orders by status</h3>
              <Link to="/statistics" className="muted" style={{ fontSize: 13 }}>
                more →
              </Link>
            </div>
            {statusBreakdown.length === 0 ? (
              <EmptyState title="No orders yet" body="Order status distribution will appear here." />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={statusBreakdown}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={3}
                    >
                      {statusBreakdown.map((slice, index) => (
                        <Cell key={slice.name} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [formatNumber(Number(value ?? 0)), humanizeStatus(String(name))]} />
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  {statusBreakdown.map((slice, index) => (
                    <div key={slice.name} className="list-row">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: STATUS_COLORS[index % STATUS_COLORS.length],
                            display: 'inline-block',
                          }}
                        />
                        {humanizeStatus(slice.name)}
                      </span>
                      <span className="cell-strong">{formatNumber(slice.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Approval pulse</h3>
              <Link to="/approvals" className="muted" style={{ fontSize: 13 }}>
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
            <Link to="/orders" className="muted" style={{ fontSize: 13 }}>
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
                    <th>Order</th>
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
