import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import RangePicker from '../components/RangePicker';
import StatusBadge from '../components/StatusBadge';
import { useSnapshot } from '../contexts/SnapshotContext';
import { getOrderDate, type RangeDays } from '../lib/analytics';
import { describeClosure } from '../lib/closedOrders';
import { formatCurrency, formatDateTime, formatNumber, humanizeStatus } from '../lib/format';
import { resolveViewState } from '../lib/viewState';
import { getOrderTone, getPaymentTone } from '../theme/tones';
import KpiCard from '../components/KpiCard';

export default function OrdersPage() {
  const { snapshot, error, hasData, refresh } = useSnapshot();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [lookupValue, setLookupValue] = useState('');
  const navigate = useNavigate();

  // Cancelled, rejected and failed-delivery orders are not in the snapshot
  // table (the feed drops them), so they cannot be clicked into. This opens
  // any order by its full id; the 8-character code shown in the table is
  // resolved against the snapshot first so it works for visible rows too.
  const handleLookup = (event: FormEvent) => {
    event.preventDefault();
    const raw = lookupValue.trim().replace(/^#/, '');

    if (!raw) {
      return;
    }

    const upper = raw.toUpperCase();
    const shortMatches = snapshot.orders.filter((order) => String(order.id).toUpperCase().endsWith(upper));
    const resolvedId = shortMatches.length === 1 ? shortMatches[0].id : raw;

    navigate(`/orders/${encodeURIComponent(resolvedId)}`);
  };

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

  // Same predicate as the Dashboard's "Pending payments" (computeProblemCounts
  // in lib/analytics.ts). In this feed a payment is still 'pending' only on a
  // cash order -- the snapshot drops prepaid orders that are not paid -- so
  // these are cash orders a rider or the restaurant has not collected yet.
  const uncollected = useMemo(() => {
    const pending = filteredOrders.filter(
      (order) => (order.payment?.status ?? '').toString().toLowerCase() === 'pending'
    );
    return {
      count: pending.length,
      amount: pending.reduce((total, order) => total + (order.pricing?.total ?? 0), 0),
    };
  }, [filteredOrders]);

  // Every flagged order, whatever its status and outside the date range: the
  // table below is the reporting feed and has no cancelled or rejected rows, so
  // a refund to return by hand on a rejected order would never appear in it.
  const attentionOrders = useMemo(
    () =>
      [...(snapshot.attentionOrders ?? [])].sort(
        (left, right) => (getOrderDate(right)?.getTime() ?? 0) - (getOrderDate(left)?.getTime() ?? 0)
      ),
    [snapshot.attentionOrders]
  );

  // Cancelled and rejected orders in the selected period. They follow the date
  // range but not the status and payment filters, which are built from the
  // reporting feed and never list a closed status. `undefined` means the server
  // does not send the list yet, which hides the section rather than claiming
  // there were none.
  const closedAvailable = snapshot.closedOrders !== undefined;
  const closedOrders = useMemo(() => {
    const start = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

    return [...(snapshot.closedOrders ?? [])]
      .filter((order) => {
        const created = getOrderDate(order);
        return created !== null && created.getTime() >= start;
      })
      .sort((left, right) => (getOrderDate(right)?.getTime() ?? 0) - (getOrderDate(left)?.getTime() ?? 0));
  }, [snapshot.closedOrders, rangeDays]);

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

  /**
   * An empty table has two completely different causes here, and the one
   * sentence on screen covered neither: "Try a wider date range or a different
   * status filter" is advice, offered identically whether or not a filter is
   * even set. Three controls narrow this view and the operator can see all
   * three, but not which of them emptied it -- so this names the ones that are
   * actually filtering, and says nothing about filters when none are.
   */
  const activeFilters = [
    statusFilter !== 'all' ? `a ${humanizeStatus(statusFilter)} status` : null,
    paymentFilter !== 'all' ? `a ${humanizeStatus(paymentFilter)} payment` : null,
  ].filter((label): label is string => label !== null);

  const emptyOrdersCopy =
    activeFilters.length > 0
      ? {
          title: 'No orders match these filters',
          body: `Nothing in the last ${rangeDays} days has ${activeFilters.join(' and ')}. Orders may exist outside this window or under another status, so clear the filters or widen the range.`,
        }
      : {
          title: `No orders in the last ${rangeDays} days`,
          body: 'No status or payment filter is applied, so this is every order in the window. Widen the range to look further back.',
        };

  return (
    <div className="page">
      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

      {/*
        Three sections, in the order the Dashboard set: money first, then what
        needs a person, then the rows themselves.

        The period and the two filters sit with the totals at the top because
        they govern BOTH the totals and the order list at the bottom. "Needs
        attention" sits between them and is NOT filtered by any of them -- it is
        built from snapshot.attentionOrders, not filteredOrders -- so it says
        so, the same way the Dashboard's charts say they ignore its date range.
        Before this, the filters sat directly above that list and read as
        though they narrowed it.
      */}
      <section className="dash-section" aria-labelledby="orders-totals">
        <div className="section-head">
          <div>
            <h2 id="orders-totals" className="section-title">
              Totals
            </h2>
            <p className="section-note">For the period and filters chosen here. They also filter the order list below.</p>
          </div>
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
        </div>

        {/* A count and a money total are claims about the business, so they may
            only be made about data that actually arrived. Ungated, the old
            "0 orders · NGN 0" line read that way during every load and
            permanently after a failed fetch, because SnapshotContext keeps its
            EMPTY_SNAPSHOT on the catch path. Same defect the three dashboard
            screens had.

            No deltas against an earlier period: with a status or payment
            filter applied, the earlier window is a different slice of the
            business, and a percentage between the two would measure the filter
            as much as the trend. */}
        {hasData ? (
          <div className="kpi-grid kpi-grid-3">
            <KpiCard label="Orders" value={formatNumber(filteredOrders.length)} caption={`In the last ${rangeDays} days`} />
            <KpiCard
              label="Order value"
              value={formatCurrency(totalValue, currency)}
              caption="Customer totals, delivery and tips included"
            />
            <KpiCard
              label="Uncollected cash"
              value={formatCurrency(uncollected.amount, currency)}
              caption={`${formatNumber(uncollected.count)} cash orders not yet collected`}
            />
          </div>
        ) : null}
      </section>

      {hasData && attentionOrders.length > 0 ? (
        <section className="dash-section" aria-labelledby="orders-attention">
          <div className="section-head">
            <div>
              <h2 id="orders-attention" className="section-title">
                Needs attention ({formatNumber(attentionOrders.length)})
              </h2>
              <p className="section-note">
                Flagged orders of any status, cancelled and rejected included. Not filtered by the choices above.
              </p>
            </div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order id</th>
                    <th>Restaurant</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Date &amp; time</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionOrders.map((order) => (
                    <tr key={order.id}>
                      <td className="cell-strong">
                        <Link to={`/orders/${encodeURIComponent(order.id)}`}>
                          #{String(order.id).slice(-8).toUpperCase()}
                        </Link>
                      </td>
                      <td>{order.restaurantName || 'Unknown restaurant'}</td>
                      <td>
                        <StatusBadge label={order.status} tone={getOrderTone(order.status)} />
                        {order.customerIssueReportedAt ? (
                          <span className="badge badge-warning">Problem reported</span>
                        ) : null}
                      </td>
                      <td>
                        <StatusBadge
                          label={order.payment?.status ?? 'unknown'}
                          tone={getPaymentTone(order.payment?.status?.toString())}
                        />
                      </td>
                      <td className="muted">{formatDateTime(order.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <section className="dash-section" aria-labelledby="orders-list">
        <div className="section-head">
          <div>
            <h2 id="orders-list" className="section-title">
              All orders
            </h2>
            <p className="section-note">Matching the period and filters above.</p>
          </div>
          {/* Opening one order by id belongs with the list: it is how you find
              a row, including the cancelled and failed ones this feed leaves
              out (see handleLookup). */}
          <form className="filters-row" onSubmit={handleLookup}>
            <input
              className="select-pill"
              value={lookupValue}
              onChange={(event) => setLookupValue(event.target.value)}
              placeholder="Look up an order by id (includes cancelled / failed)"
              aria-label="Order id"
              style={{ minWidth: 320 }}
            />
            <button type="submit" className="btn btn-ghost btn-sm" disabled={lookupValue.trim() === ''}>
              Open order
            </button>
          </form>
        </div>

        <div className="card">
          {/* The skeleton belongs INSIDE the card, in place of the table. As a
              sibling above it, a first load painted shimmer bars and a complete
              empty table at the same time: two loading metaphors, one of which
              reads as an answer. */}
          {ordersState === 'loading' ? <SkeletonRows count={8} /> : null}
          {ordersState === 'empty' ? <EmptyState {...emptyOrdersCopy} /> : null}
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
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr key={order.id}>
                      <td className="cell-strong">
                        <Link to={`/orders/${encodeURIComponent(order.id)}`}>
                          #{String(order.id).slice(-8).toUpperCase()}
                        </Link>
                      </td>
                      <td>{order.restaurantName || 'Unknown restaurant'}</td>
                      <td className="muted">{humanizeStatus(order.fulfillmentType)}</td>
                      <td>
                        <StatusBadge label={order.status} tone={getOrderTone(order.status)} />
                        {/* An escalated order stays `placed` -- the acceptance
                            sweep raises this flag instead of moving the status,
                            so `status` alone cannot tell the operator that the
                            restaurant's clock already ran out. The flag is also
                            raised by a late payment, a refund to return by hand
                            and a customer problem report. */}
                        {order.needsAttention === true ? (
                          <span className="badge badge-warning" title="Flagged for an admin. Open the order to see why.">
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
      </section>

      {hasData && closedAvailable ? (
        <section className="dash-section" aria-labelledby="orders-closed">
          <div className="section-head">
            <div>
              <h2 id="orders-closed" className="section-title">
                Cancelled and rejected ({formatNumber(closedOrders.length)})
              </h2>
              <p className="section-note">
                In the selected period, whatever the status and payment filters. Not counted in the totals: these
                orders were never paid or never served.
              </p>
            </div>
          </div>
          <div className="card">
            {closedOrders.length === 0 ? (
              <EmptyState
                title={`No cancelled or rejected orders in the last ${rangeDays} days`}
                body="Widen the range to look further back. This list covers up to 90 days."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Order id</th>
                      <th>Restaurant</th>
                      <th>Status</th>
                      <th>Why</th>
                      <th>By</th>
                      <th>Date &amp; time</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedOrders.map((order) => {
                      const closure = describeClosure(order);

                      return (
                        <tr key={order.id}>
                          <td className="cell-strong">
                            <Link to={`/orders/${encodeURIComponent(order.id)}`}>
                              #{String(order.id).slice(-8).toUpperCase()}
                            </Link>
                          </td>
                          <td>{order.restaurantName || 'Unknown restaurant'}</td>
                          <td>
                            <StatusBadge label={order.status} tone={getOrderTone(order.status)} />
                          </td>
                          <td>{closure.why}</td>
                          <td className="muted">{closure.by}</td>
                          <td className="muted">{formatDateTime(order.createdAt)}</td>
                          <td className="cell-amount">
                            {formatCurrency(order.pricing?.total ?? 0, order.pricing?.currency ?? currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
