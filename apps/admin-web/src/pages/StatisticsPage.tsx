import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import RangePicker from '../components/RangePicker';
import { useSnapshot } from '../contexts/SnapshotContext';
import {
  buildDailySeries,
  buildStatusBreakdown,
  buildTopRestaurants,
  buildZoneBreakdown,
  getOrderDate,
  type RangeDays,
} from '../lib/analytics';
import { formatCurrency, formatNumber, humanizeStatus } from '../lib/format';

const STATUS_COLORS = ['#18b26b', '#b5e48c', '#f4a261', '#117c6a', '#c54a43', '#5b6978', '#0f7f4c', '#b86f1f'];

export default function StatisticsPage() {
  const { snapshot, loading, error, refresh } = useSnapshot();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  const windowedOrders = useMemo(() => {
    const start = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    return snapshot.orders.filter((order) => {
      const created = getOrderDate(order);
      return created !== null && created >= start;
    });
  }, [snapshot.orders, rangeDays]);

  const dailySeries = useMemo(() => buildDailySeries(windowedOrders, rangeDays), [windowedOrders, rangeDays]);
  const statusBreakdown = useMemo(() => buildStatusBreakdown(windowedOrders), [windowedOrders]);
  const topRestaurants = useMemo(() => buildTopRestaurants(windowedOrders), [windowedOrders]);
  const zoneBreakdown = useMemo(() => buildZoneBreakdown(snapshot.dispatchProfiles), [snapshot.dispatchProfiles]);
  const currency = windowedOrders.find((order) => order.pricing?.currency)?.pricing?.currency ?? 'NGN';

  const hasOrders = windowedOrders.length > 0;

  return (
    <div className="page">
      <div className="page-header">
        <div className="filters-row">
          <RangePicker value={rangeDays} onChange={setRangeDays} />
        </div>
        <div className="muted">{formatNumber(windowedOrders.length)} orders in window</div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {loading ? <LoadingBlock label="Loading statistics…" /> : null}

      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Revenue over time</h3>
        </div>
        {!hasOrders ? (
          <EmptyState title="No revenue data" body="Revenue will chart here once orders land in this window." />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={dailySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dde7e3" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 12 }} width={80} />
              <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0), currency)} />
              <Line type="monotone" dataKey="revenue" stroke="#18b26b" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">Orders by status</h3>
          </div>
          {statusBreakdown.length === 0 ? (
            <EmptyState title="No orders" body="Status breakdown appears once orders exist in this window." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={3}>
                  {statusBreakdown.map((slice, index) => (
                    <Cell key={slice.name} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [formatNumber(Number(value ?? 0)), humanizeStatus(String(name))]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">Orders per day</h3>
          </div>
          {!hasOrders ? (
            <EmptyState title="No orders" body="Daily volume appears once orders exist in this window." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dde7e3" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={40} />
                <Tooltip formatter={(value) => [formatNumber(Number(value ?? 0)), 'Orders']} />
                <Bar dataKey="orders" fill="#18b26b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">Dispatch riders by zone</h3>
          </div>
          {zoneBreakdown.length === 0 ? (
            <EmptyState title="No riders" body="Zone coverage appears once dispatch riders are registered." />
          ) : (
            zoneBreakdown.map((zone) => (
              <div key={zone.name} className="list-row">
                <span>{zone.name}</span>
                <span className="cell-strong">{formatNumber(zone.value)}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">Top restaurants by revenue</h3>
          </div>
          {topRestaurants.length === 0 ? (
            <EmptyState title="No restaurant activity" body="Top performers appear once orders exist in this window." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Restaurant</th>
                    <th>Orders</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topRestaurants.map((restaurant) => (
                    <tr key={restaurant.name}>
                      <td className="cell-strong">{restaurant.name}</td>
                      <td>{formatNumber(restaurant.orders)}</td>
                      <td className="cell-amount">{formatCurrency(restaurant.revenue, currency)}</td>
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
