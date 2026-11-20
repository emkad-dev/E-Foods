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
import { useNavCounts } from '../contexts/NavCountsContext';
import { useSnapshot } from '../contexts/SnapshotContext';
import {
  buildPaymentBreakdown,
  buildStatusBreakdown,
  computeDashboardKpis,
  computeProblemCounts,
  getOrderDate,
  type RangeDays,
} from '../lib/analytics';
import { describeCancelledBreakdown, summarizeClosedOrders } from '../lib/closedOrders';
import { rangeShortLabel, resolveRangeDays } from '../lib/ranges';
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
  // The sidebar's SOS count, read once for the whole console: the tile costs
  // no extra request. null means "not known", never "none".
  const { sos: sosCount } = useNavCounts();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  // "All time" has no fixed length: it reaches back to the oldest record this
  // page can see. Every window below is built from this resolved span, so all
  // time is simply the longest window -- and the window before it, which
  // predates the first record, honestly has nothing to compare against.
  const recordsHorizon = useMemo(
    () =>
      earlierOf(
        earlierOf(
          earliestDateIn(snapshot.orders, getOrderDate),
          earliestDateIn(snapshot.users, (user) => parseTimestamp(user.createdAt))
        ),
        earliestDateIn(snapshot.closedOrders ?? [], getOrderDate)
      ),
    [snapshot.orders, snapshot.users, snapshot.closedOrders]
  );
  const spanDays = resolveRangeDays(rangeDays, recordsHorizon);

  const kpis = useMemo(
    () =>
      computeDashboardKpis(snapshot.orders, snapshot.users, snapshot.restaurants, snapshot.dispatchProfiles, spanDays),
    [snapshot, spanDays]
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
    const windows = buildPeriodWindows(spanDays);
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
  }, [snapshot.orders, snapshot.users, spanDays]);

  const problemCounts = windowComparison.problems;

  // Cancelled and rejected orders in the selected period, from the snapshot's
  // closedOrders list (kept out of revenue). null when the server does not send
  // the list yet, so the tiles show "—" instead of a confident zero.
  const closedSummary = useMemo(() => {
    if (snapshot.closedOrders === undefined) {
      return null;
    }

    const windows = buildPeriodWindows(spanDays);
    return summarizeClosedOrders(
      filterWithin(snapshot.closedOrders, getOrderDate, windows.currentStart, windows.currentEnd)
    );
  }, [snapshot.closedOrders, spanDays]);

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
      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {dataState === 'loading' ? <SkeletonRows count={4} /> : null}

      {dataState === 'ready' ? (
        <>
          {/*
            Four sections, each grouping what answers the same question, in
            the order the owner reads the business: how it is performing, what
            is happening at this moment, how orders and payments break down,
            and finally the individual orders and restaurants behind those
            figures. Money and growth lead because they are what the page is
            opened to check every day; the rows that explain them come last.

            The date picker sits inside Performance, the only section it
            controls. It used to sit above everything, which implied it
            filtered the live counts, both charts and both lists -- it never
            did.
          */}

          {/* PERFORMANCE: the windowed business figures and the picker that
              governs them. Revenue leads because it is the figure the business
              is judged on. */}
          <section className="dash-section" aria-labelledby="dash-performance">
            <div className="section-head">
              <div>
                <h2 id="dash-performance" className="section-title">
                  Performance
                </h2>
                <p className="section-note">Totals for the selected period.</p>
              </div>
              <RangePicker value={rangeDays} onChange={setRangeDays} />
            </div>

            {/* Six figures, three across: the money and growth row, then the
                problem row (pending cash, cancelled, rejected). */}
            <div className="kpi-grid kpi-grid-3">
              <KpiCard
                label={`Revenue (${rangeShortLabel(rangeDays)})`}
                value={formatCurrency(kpis.revenue.current, kpis.currency)}
                {...compare(kpis.revenue.current, kpis.revenue.previous)}
              />
              <KpiCard
                label={`Orders (${rangeShortLabel(rangeDays)})`}
                value={formatNumber(kpis.orders.current)}
                {...compare(kpis.orders.current, kpis.orders.previous)}
              />
              <KpiCard
                label={`New users (${rangeShortLabel(rangeDays)})`}
                value={formatNumber(kpis.newUsers.current)}
                {...compare(kpis.newUsers.current, kpis.newUsers.previous)}
              />
              {/* Survives the filter only when the payment is cash: a cash order
                  is 'pending' until a rider or the restaurant collects on
                  delivery, at which point both handoff paths mark it paid. So
                  this is uncollected cash, not the stuck card checkouts the
                  label brings to mind -- those are filtered out upstream. Left
                  un-compared deliberately: the tail of the current window is
                  full of orders that are merely still in flight, while the
                  previous window's are ones that never resolved, so a delta
                  between the two would be measuring two different things. */}
              <KpiCard
                label={`Pending payments (${rangeShortLabel(rangeDays)})`}
                value={formatNumber(problemCounts.pendingPayments)}
                caption="Uncollected cash in window"
              />
              {/* These two used to read "not in this feed": the snapshot dropped
                  every closed order. It now sends them as closedOrders, kept out
                  of revenue. The caption says what "Cancelled" is made of, so 59
                  abandoned checkouts are never read as 59 unhappy customers. */}
              <KpiCard
                label={`Cancelled orders (${rangeShortLabel(rangeDays)})`}
                value={closedSummary ? formatNumber(closedSummary.cancelled) : '—'}
                caption={closedSummary ? describeCancelledBreakdown(closedSummary) : 'Not sent by the server yet'}
              />
              <KpiCard
                label={`Rejected (${rangeShortLabel(rangeDays)})`}
                value={closedSummary ? formatNumber(closedSummary.rejected) : '—'}
                caption={closedSummary ? 'Turned down by restaurants' : 'Not sent by the server yet'}
              />
            </div>

          </section>

          {/* RIGHT NOW: live counts, unaffected by the date range. */}
          <section className="dash-section" aria-labelledby="dash-now">
            <div className="section-head">
              <h2 id="dash-now" className="section-title">
                Right now
              </h2>
            </div>

            {/* caption={null}: the section heading already says these figures
                are live, so a "Live count" line under each repeated it.

                Every tile is a link to the page where you act on it. SOS is
                last in the row but the loudest when it fires: the danger tint
                and a red figure whenever any rider has raised one in the last
                24 hours. An unknown count reads "—" with a caption, never 0,
                because a zero here would claim no rider is in trouble. */}
            <div className="kpi-grid">
              <KpiCard label="Live orders" value={formatNumber(kpis.liveOrders)} caption={null} href="/orders" />
              <KpiCard
                label="Dispatch online"
                value={formatNumber(kpis.dispatchOnline)}
                caption={null}
                href="/dispatch"
              />
              <KpiCard
                label="Pending approvals"
                value={formatNumber(kpis.pendingApprovals)}
                caption={null}
                attention={kpis.pendingApprovals > 0}
                href="/approvals"
              />
              <KpiCard
                label="SOS (24h)"
                value={sosCount === null ? '—' : formatNumber(sosCount)}
                caption={sosCount === null ? 'Count unavailable' : null}
                alert={sosCount !== null && sosCount > 0}
                href="/dispatch"
              />
            </div>
          </section>

          {/* MIX: both charts read every order in the snapshot. The note says
              so explicitly, because a chart near a date picker reads as though
              the picker filters it. */}
          <section className="dash-section" aria-labelledby="dash-mix">
            <div className="section-head">
              <div>
                <h2 id="dash-mix" className="section-title">
                  Order and payment mix
                </h2>
                <p className="section-note">Not filtered by the date range.</p>
              </div>
            </div>

            <div className="grid-even">
              <BreakdownCard
                title="Orders by status"
                moreHref="/statistics"
                moreLabel="See statistics"
                slices={statusBreakdown}
                colorFor={getStatusChartColor}
                emptyTitle="No orders yet"
                emptyBody="Order status distribution will appear here."
              />

              <BreakdownCard
                title="Payments by status"
                moreHref="/statistics"
                moreLabel="See statistics"
                slices={paymentBreakdown}
                colorFor={getPaymentChartColor}
                emptyTitle="No payments yet"
                emptyBody="Payment status distribution will appear here."
              />
            </div>
          </section>

          {/* The individual rows behind the figures above, last. The approval
              queue takes the narrow left column and latest orders the wide
              right one: .grid-2 is built for exactly that split, and the
              five-column table needs the width. Below the breakpoint the queue
              stacks first, which also puts the short, actionable list ahead of
              the long one. No section heading: each card already names itself,
              and a heading over both could only repeat them. */}
          <section className="dash-section" aria-label="Approval queue and latest orders">
            <div className="grid-2">
              <div className="card">
                <div className="card-title-row">
                  <h3 className="card-title">Approval queue</h3>
                  {/* `card-more-link` is what carries this link over the
                      24x24 target floor; as bare inline text it measured
                      45x17. See global.css. */}
                  <Link to="/approvals" className="muted text-[13px] card-more-link">
                    Review all
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

              <div className="card">
                <div className="card-title-row">
                  <h3 className="card-title">Latest orders</h3>
                  <Link to="/orders" className="muted text-[13px] card-more-link">
                    All orders
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
                          <th className="num">Amount</th>
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
          </section>
        </>
      ) : null}
    </div>
  );
}
