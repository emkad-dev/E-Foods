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
import { SkeletonRows } from '../components/Skeleton';
import RangePicker from '../components/RangePicker';
import { useSnapshot } from '../contexts/SnapshotContext';
import {
  buildDailySeries,
  buildPaymentBreakdown,
  buildProblemDailySeries,
  buildSettlementBreakdown,
  buildStatusBreakdown,
  buildTopRestaurants,
  buildZoneBreakdown,
  getOrderDate,
  type RangeDays,
} from '../lib/analytics';
import { formatCurrency, formatNumber, humanizeStatus, parseTimestamp } from '../lib/format';
import {
  buildPeriodWindows,
  comparisonText,
  coversPreviousWindow,
  earlierOf,
  earliestDateIn,
  filterWithin,
  noPriorWindowNote,
} from '../lib/periodComparison';
import { resolveViewState } from '../lib/viewState';
import { getPaymentChartColor, getStatusChartColor } from '../theme/tones';

/**
 * How many settlement rows the table renders. It was an inline `.slice(0, 12)`
 * with nothing on screen admitting to it, so a 12-row month and a 400-row
 * month looked identical and the operator had no way to know money was being
 * left off the bottom. Named here, and stated in the card header below.
 */
const SETTLEMENT_ROW_CAP = 12;

/**
 * How many restaurants the revenue leaderboard lists. buildTopRestaurants caps
 * at six by default and the page never passed or mentioned a limit, so the
 * other money table on this screen had exactly the defect the settlement table
 * above was fixed for: six rows look the same whether the platform has six
 * restaurants or six hundred. Passed explicitly here so the cap is visible at
 * the call site, and stated in the card header below.
 */
const TOP_RESTAURANT_ROW_CAP = 6;

export default function StatisticsPage() {
  const { snapshot, error, hasData, refresh } = useSnapshot();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  /**
   * The window's orders, the equal-length window before it, and whether that
   * earlier window is one the snapshot can speak for.
   *
   * The count in the page header was the page's one bare figure -- "1,204
   * orders in window" says nothing about whether that is a good week. The
   * comparison needs no new backend read: `adminGetDashboardSnapshot` returns
   * the whole history, so the previous window is the same filter run one
   * window earlier, and it is the same pair of windows the Overview KPIs use.
   *
   * `previousWindowCovered` is what keeps that honest. If the platform is
   * younger than the selected range, the previous window holds no records and
   * "0 orders then" is an absence of measurement, not a measurement of zero.
   *
   * The current window is also now half-open [start, now) rather than the
   * unbounded `created >= start` it replaces, so a future-dated row can no
   * longer be counted in the header while being absent from every chart below
   * it -- `buildDailySeries` only buckets days up to today.
   */
  const orderWindows = useMemo(() => {
    const windows = buildPeriodWindows(rangeDays);
    const dataHorizon = earlierOf(
      earliestDateIn(snapshot.orders, getOrderDate),
      earliestDateIn(snapshot.users, (user) => parseTimestamp(user.createdAt))
    );

    return {
      current: filterWithin(snapshot.orders, getOrderDate, windows.currentStart, windows.currentEnd),
      previousCount: filterWithin(snapshot.orders, getOrderDate, windows.previousStart, windows.previousEnd).length,
      previousWindowCovered: coversPreviousWindow(dataHorizon, windows),
    };
  }, [snapshot.orders, snapshot.users, rangeDays]);

  const windowedOrders = orderWindows.current;

  const dailySeries = useMemo(() => buildDailySeries(windowedOrders, rangeDays), [windowedOrders, rangeDays]);
  const statusBreakdown = useMemo(() => buildStatusBreakdown(windowedOrders), [windowedOrders]);
  const paymentBreakdown = useMemo(() => buildPaymentBreakdown(windowedOrders), [windowedOrders]);
  const problemSeries = useMemo(() => buildProblemDailySeries(windowedOrders, rangeDays), [windowedOrders, rangeDays]);
  const settlementBreakdown = useMemo(() => buildSettlementBreakdown(windowedOrders), [windowedOrders]);
  // The settlement table renders only the first SETTLEMENT_ROW_CAP rows. The
  // full breakdown is computed here in the client, so unlike the alert queue
  // the true total is known exactly and can simply be stated.
  const settlementShown = Math.min(settlementBreakdown.length, SETTLEMENT_ROW_CAP);
  const topRestaurants = useMemo(
    () => buildTopRestaurants(windowedOrders, TOP_RESTAURANT_ROW_CAP),
    [windowedOrders]
  );
  // The leaderboard is truncated, so its own length can never be the total.
  // Counting the distinct restaurants in the window here -- keyed exactly the
  // way buildTopRestaurants keys them, so the two agree -- is what lets the
  // header say how many performers are being left off the bottom.
  const restaurantsInWindow = useMemo(
    () =>
      new Set(windowedOrders.map((order) => order.restaurantId || order.restaurantName || 'unknown')).size,
    [windowedOrders]
  );
  const zoneBreakdown = useMemo(() => buildZoneBreakdown(snapshot.dispatchProfiles), [snapshot.dispatchProfiles]);
  const currency = windowedOrders.find((order) => order.pricing?.currency)?.pricing?.currency ?? 'NGN';

  const hasOrders = windowedOrders.length > 0;

  // All eight panels below decide their empty state from `windowedOrders`,
  // which is derived from a snapshot that is EMPTY_SNAPSHOT both before the
  // first read lands and forever after a failed one. Gating the body on a
  // snapshot that actually arrived is what makes "No orders", "No payments"
  // and "No settlement data" statements of fact rather than of ignorance.
  const dataState = resolveViewState({ hasData, error });

  return (
    <div className="page">
      <div className="page-header">
        <div className="filters-row">
          <RangePicker value={rangeDays} onChange={setRangeDays} />
        </div>
        {dataState === 'ready' ? (
          <div className="muted">
            {formatNumber(windowedOrders.length)} orders in window ·{' '}
            {comparisonText({
              current: windowedOrders.length,
              previous: orderWindows.previousCount,
              previousWindowCovered: orderWindows.previousWindowCovered,
              fallback: noPriorWindowNote(rangeDays),
            })}
          </div>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {dataState === 'loading' ? <SkeletonRows count={4} /> : null}

      {dataState === 'ready' ? (
        <>
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
                  <Line type="monotone" dataKey="revenue" stroke="#2e7d32" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-title-row">
                <h3 className="card-title">Orders by status</h3>
                {/* `buildStatusBreakdown` even pins a display slot for
                    'cancelled', but the feed can never deliver one. Saying so
                    is the difference between "no cancellations" and "no
                    cancellations visible here". */}
                <span className="muted">Cancelled not in this feed</span>
              </div>
              {statusBreakdown.length === 0 ? (
                <EmptyState title="No orders" body="Status breakdown appears once orders exist in this window." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={3}>
                      {statusBreakdown.map((slice, index) => (
                        <Cell key={slice.name} fill={getStatusChartColor(slice.name, index)} />
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
                    <Bar dataKey="orders" fill="#f57c00" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-title-row">
                <h3 className="card-title">Payments by status</h3>
                {/* Same exclusion: a failed payment is always a prepaid,
                    cancelled order, so this breakdown can only ever show paid
                    and (cash) pending. Without the note, an operator reads a
                    failure-free pie as a failure-free platform. */}
                <span className="muted">Failed not in this feed</span>
              </div>
              {paymentBreakdown.length === 0 ? (
                <EmptyState title="No payments" body="Payment breakdown appears once orders exist in this window." />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={paymentBreakdown} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
                        {paymentBreakdown.map((slice, index) => (
                          <Cell key={slice.name} fill={getPaymentChartColor(slice.name, index)} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name) => [formatNumber(Number(value ?? 0)), humanizeStatus(String(name))]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div>
                    {paymentBreakdown.map((slice, index) => (
                      <div key={slice.name} className="list-row">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: getPaymentChartColor(slice.name, index),
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
                <h3 className="card-title">Problem transactions per day</h3>
                {/* Two of this chart's three series can never plot a bar. The
                    snapshot RPC filters every order through
                    `isOrderCleanForReporting`, which drops cancelled orders and
                    unpaid prepaid ones, and every `payment.status = 'failed'`
                    write path is a Paystack one that also cancels the order. An
                    empty chart titled "problem transactions" reads as "no
                    problems", so it has to say which problems it cannot see. */}
                <span className="muted">Failed and cancelled are not in this feed</span>
              </div>
              {!hasOrders ? (
                <EmptyState
                  title="No orders"
                  body="Pending-payment activity appears once orders exist in this window."
                />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={problemSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dde7e3" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={40} />
                    <Tooltip
                      formatter={(value, name) => [formatNumber(Number(value ?? 0)), humanizeStatus(String(name))]}
                    />
                    <Bar dataKey="failed" name="Failed payments" stackId="problems" fill="#c54a43" />
                    <Bar dataKey="pending" name="Pending payments" stackId="problems" fill="#f57c00" />
                    <Bar dataKey="cancelled" name="Cancelled orders" stackId="problems" fill="#5b6978" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Settlement by restaurant and day</h3>
              {settlementBreakdown.length > 0 ? (
                <span className="muted">
                  {settlementBreakdown.length > SETTLEMENT_ROW_CAP
                    ? `Showing ${settlementShown} of ${formatNumber(settlementBreakdown.length)} rows`
                    : `${settlementBreakdown.length} rows`}
                </span>
              ) : null}
            </div>
            {settlementBreakdown.length === 0 ? (
              <EmptyState
                title="No settlement data"
                body="Split and manual settlement totals will appear once paid orders land."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Restaurant</th>
                      <th>Orders</th>
                      <th>Gross</th>
                      <th>Split</th>
                      <th>Manual</th>
                      <th>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlementBreakdown.slice(0, SETTLEMENT_ROW_CAP).map((row) => (
                      <tr key={`${row.dayKey}:${row.restaurantId}`}>
                        <td>{row.dayLabel}</td>
                        <td className="cell-strong">{row.restaurantName}</td>
                        <td>{formatNumber(row.orders)}</td>
                        <td className="cell-amount">{formatCurrency(row.gross, currency)}</td>
                        <td className="cell-amount">{formatCurrency(row.split, currency)}</td>
                        <td className="cell-amount">{formatCurrency(row.manual, currency)}</td>
                        <td className="cell-amount">{formatCurrency(row.delta, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                {restaurantsInWindow > 0 ? (
                  <span className="muted">
                    {restaurantsInWindow > TOP_RESTAURANT_ROW_CAP
                      ? `Top ${topRestaurants.length} of ${formatNumber(restaurantsInWindow)}`
                      : `${formatNumber(restaurantsInWindow)} restaurants`}
                  </span>
                ) : null}
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
        </>
      ) : null}
    </div>
  );
}
