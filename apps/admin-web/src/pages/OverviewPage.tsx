import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BreakdownCard from '../components/BreakdownCard';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import KpiCard from '../components/KpiCard';
import { SkeletonRows } from '../components/Skeleton';
import RangePicker from '../components/RangePicker';
import RestaurantRating from '../components/RestaurantRating';
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
import { formatCurrency, formatDateTime, formatNumber, parseTimestamp } from '../lib/format';
import {
  buildPeriodWindows,
  coversPreviousWindow,
  earlierOf,
  earliestDateIn,
  filterWithin,
  kpiComparison,
  windowTotalCaption,
} from '../lib/periodComparison';
import { resolveViewState } from '../lib/viewState';
import { getApprovalTone, getOrderTone, getPaymentChartColor, getStatusChartColor } from '../theme/tones';

export default function OverviewPage() {
  const { snapshot, error, hasData, refresh } = useSnapshot();
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

  /**
   * The window's problem counts, plus whether the window BEFORE it is one this
   * snapshot can speak for at all.
   *
   * `previousWindowCovered` is the honesty gate on every delta this page
   * renders. `computeDashboardKpis` happily reports a previous period of zero
   * whether the platform was quiet or did not yet exist, and `formatDeltaPercent`
   * turns a zero previous into "▲ New activity" -- so on a platform younger
   * than the selected range, all three cards below were asserting a trend
   * inferred from the absence of data. The horizon is the oldest record in
   * hand (users predate orders on a real platform); before it, a count of zero
   * means "we cannot see", not "it did not happen".
   *
   * The window is also now half-open and equal-length on both sides, matching
   * `computeDashboardKpis` exactly, rather than the unbounded `created >= start`
   * filter this replaces -- which let a future-dated row inflate the count.
   */
  const windowComparison = useMemo(() => {
    const windows = buildPeriodWindows(rangeDays);
    const dataHorizon = earlierOf(
      earliestDateIn(snapshot.orders, getOrderDate),
      earliestDateIn(snapshot.users, (user) => parseTimestamp(user.createdAt))
    );

    return {
      previousWindowCovered: coversPreviousWindow(dataHorizon, windows),
      problems: computeProblemCounts(
        filterWithin(snapshot.orders, getOrderDate, windows.currentStart, windows.currentEnd)
      ),
    };
  }, [snapshot.orders, snapshot.users, rangeDays]);

  const problemCounts = windowComparison.problems;

  // The three windowed cards ask the same question of the same two windows, so
  // it is asked once here.
  const compare = (current: number, previous: number) =>
    kpiComparison({
      current,
      previous,
      previousWindowCovered: windowComparison.previousWindowCovered,
      fallbackCaption: windowTotalCaption(rangeDays),
    });

  const paymentBreakdown = useMemo(() => buildPaymentBreakdown(snapshot.orders).slice(0, 8), [snapshot.orders]);

  const approvalPulse = useMemo(
    () =>
      snapshot.restaurants
        .filter((restaurant) => restaurant.isPublished !== true)
        .slice(0, 5),
    [snapshot.restaurants]
  );

  // Every figure below is an assertion about the business -- "Revenue NGN 0",
  // "Queue is clear" -- so the whole body waits for a snapshot that actually
  // arrived. The skeleton now replaces the body instead of floating above it,
  // and a failed first load shows the banner alone rather than a floor of
  // zeros. Inside `ready`, `length === 0` is finally telling the truth.
  const dataState = resolveViewState({ hasData, error });

  return (
    <div className="page">
      <div className="page-header">
        <div className="filters-row">
          <RangePicker value={rangeDays} onChange={setRangeDays} />
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {dataState === 'loading' ? <SkeletonRows count={4} /> : null}

      {dataState === 'ready' ? (
        <>
          <div className="kpi-grid">
            <KpiCard
              label={`Orders (${rangeDays}d)`}
              value={formatNumber(kpis.orders.current)}
              {...compare(kpis.orders.current, kpis.orders.previous)}
            />
            <KpiCard
              label={`Revenue (${rangeDays}d)`}
              value={formatCurrency(kpis.revenue.current, kpis.currency)}
              {...compare(kpis.revenue.current, kpis.revenue.previous)}
            />
            <KpiCard
              label={`New users (${rangeDays}d)`}
              value={formatNumber(kpis.newUsers.current)}
              {...compare(kpis.newUsers.current, kpis.newUsers.previous)}
            />
            <KpiCard label="Live orders" value={formatNumber(kpis.liveOrders)} />
            <KpiCard label="Dispatch online" value={formatNumber(kpis.dispatchOnline)} />
            <KpiCard label="Pending approvals" value={formatNumber(kpis.pendingApprovals)} />
            {/* The three below are windowed, so they must not inherit
                KpiCard's "Live count" default -- it contradicted the (30d) in
                their own labels. The three above them ARE live counts and keep
                it.

                Two of them cannot be measured from this feed AT ALL, and a
                prior-period delta was never the defect worth fixing here. The
                snapshot RPC runs every order through
                `isOrderCleanForReporting` (supabase/functions/_shared/orders.ts),
                which drops cancelled/rejected/failed-delivery orders outright
                and drops prepaid orders that are not paid. Every path that
                writes `payment.status = 'failed'` is a Paystack one and also
                cancels the order, so it is excluded twice over. The two counts
                below were therefore not low -- they were structurally,
                permanently zero, and a confident "0 cancelled orders" on an
                operations dashboard is a worse lie than a missing delta. They
                render an em dash until the feed carries the rows. */}
            <KpiCard
              label={`Failed payments (${rangeDays}d)`}
              value="—"
              caption="Not carried by this feed"
            />
            {/* Survives the filter only when the payment is cash: a cash order
                is 'pending' until a rider or the restaurant collects on
                delivery, at which point both handoff paths mark it paid. So
                this is uncollected cash, not the stuck card checkouts the
                label brings to mind -- those are filtered out above. Left
                un-compared deliberately: the tail of the current window is
                full of orders that are merely still in flight, while the
                previous window's are ones that never resolved, so a delta
                between the two would be measuring two different things. */}
            <KpiCard
              label={`Pending payments (${rangeDays}d)`}
              value={formatNumber(problemCounts.pendingPayments)}
              caption="Uncollected cash in window"
            />
            <KpiCard
              label={`Cancelled orders (${rangeDays}d)`}
              value="—"
              caption="Not carried by this feed"
            />
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
                  {/* `card-more-link` is what carries this link over the
                      24x24 target floor; as bare inline text it measured
                      45x17. See global.css. */}
                  <Link to="/approvals" className="muted text-[13px] card-more-link">
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
                        {/* This queue is restaurants awaiting review, so most
                            rows will honestly read "No ratings yet" -- a new
                            partner has not served anyone. The ones that do
                            carry a score are the interesting case: a
                            previously-published restaurant back in the queue,
                            where the rating is the fastest signal available. */}
                        <div className="restaurant-rating-line">
                          <RestaurantRating restaurant={restaurant} />
                        </div>
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
                <Link to="/orders" className="muted text-[13px] card-more-link">
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
        </>
      ) : null}
    </div>
  );
}
