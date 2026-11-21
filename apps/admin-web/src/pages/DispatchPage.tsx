import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import KpiCard from '../components/KpiCard';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { distinctOwner, summarizeRoster } from '../lib/dispatchSummary';
import { formatCurrency, formatDateTime, formatNumber, humanizeStatus } from '../lib/format';
import { usePolledRpc } from '../lib/usePolledRpc';
import { resolveViewState } from '../lib/viewState';
import { getAdminDispatchOpsView, getAdminRiderPayouts, getAdminRiderRoster } from '../services/platformReads';
import { getOrderTone, type AdminTone } from '../theme/tones';

const ID_STYLE: React.CSSProperties = { fontFamily: 'monospace', fontSize: '12px' };

// SOS coordinates arrive in an untyped details bag. A value counts only if it
// is a finite number inside the valid range; anything else is "no location",
// never a map link to 0,0.
const toCoordinate = (value: unknown, limit: number): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

const payoutTone = (status: string): AdminTone =>
  status === 'paid' ? 'success' : status === 'processing' ? 'info' : status === 'failed' || status === 'reversed' ? 'danger' : 'neutral';

/**
 * Grouped by what each part answers: what needs a person right now (SOS
 * first, as before), then the money owed to riders, then the riders and the
 * deliveries they were given.
 *
 * The three reads stay separate so one failing never blanks the others; each
 * section carries its own error. One Refresh at the top reloads all three, in
 * place of a Refresh button on every card.
 */
export default function DispatchPage() {
  const ops = usePolledRpc(getAdminDispatchOpsView);
  const roster = usePolledRpc(getAdminRiderRoster);
  const payouts = usePolledRpc(getAdminRiderPayouts);

  const opsState = resolveViewState({ hasData: ops.data !== null, error: ops.error });
  const rosterState = resolveViewState({ hasData: roster.data !== null, error: roster.error });
  const payoutsState = resolveViewState({ hasData: payouts.data !== null, error: payouts.error });

  const summary = roster.data ? summarizeRoster(roster.data.riders) : null;
  const sosCount = ops.data ? ops.data.sosEvents.length : null;
  const refreshing = ops.refreshing || roster.refreshing || payouts.refreshing;
  const refreshAll = () => {
    void ops.refresh();
    void roster.refresh();
    void payouts.refresh();
  };

  const riderLabelFor = (uid: string | null) => {
    const rider = uid ? (roster.data?.riders.find((entry) => entry.id === uid) ?? null) : null;
    return { rider, label: rider?.displayName ?? uid?.slice(-6).toUpperCase() ?? 'Unknown rider' };
  };

  return (
    <div className="page">
      {/* RIGHT NOW: what needs a person. SOS stays first. */}
      <section className="dash-section" aria-labelledby="dispatch-now">
        <div className="section-head">
          <h2 id="dispatch-now" className="section-title">
            Right now
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={refreshAll} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {ops.error && <ErrorBanner message={ops.error} onRetry={ops.refresh} />}

        <div className="kpi-grid">
          <KpiCard
            label="SOS (24h)"
            value={sosCount === null ? '—' : formatNumber(sosCount)}
            caption={sosCount ? 'Listed below' : 'None in the last 24 hours'}
            alert={(sosCount ?? 0) > 0}
          />
          <KpiCard
            label="Riders online"
            value={summary ? formatNumber(summary.online) : '—'}
            caption={summary ? `Of ${formatNumber(summary.total)} riders` : null}
          />
          <KpiCard
            label="Carrying orders"
            value={summary ? formatNumber(summary.carrying) : '—'}
            caption="Riders with an order assigned"
          />
          <KpiCard
            label="Waiting for approval"
            value={summary ? formatNumber(summary.awaitingApproval) : '—'}
            caption="Can't be sent orders until approved"
            attention={(summary?.awaitingApproval ?? 0) > 0}
            href={summary && summary.awaitingApproval > 0 ? '/approvals' : undefined}
          />
        </div>

        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">SOS events (last 24h)</h3>
          </div>

          {opsState === 'loading' ? (
            <SkeletonRows count={3} />
          ) : opsState === 'empty' || (opsState === 'ready' && ops.data!.sosEvents.length === 0) ? (
            <EmptyState title="No SOS events" body="No rider SOS alerts in the last 24 hours." />
          ) : opsState === 'ready' ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th>Location</th>
                    <th>Triggered at</th>
                    <th>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.data!.sosEvents.map((row) => {
                    // The roster carries names but no phone numbers, so a name
                    // is the most this row can say about who; it falls back to
                    // the short code until the roster has loaded.
                    const { rider, label: riderLabel } = riderLabelFor(row.actorUid);
                    const lat = toCoordinate(row.details?.latitude, 90);
                    const lng = toCoordinate(row.details?.longitude, 180);

                    return (
                      <tr key={row.id}>
                        <td className="cell-strong">
                          {rider ? riderLabel : <span style={ID_STYLE}>{riderLabel}</span>}
                        </td>
                        <td>
                          {lat !== null && lng !== null ? (
                            <>
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open ${riderLabel}'s SOS location in Google Maps`}
                              >
                                Open map
                              </a>{' '}
                              <span className="muted" style={ID_STYLE}>
                                {lat.toFixed(5)}, {lng.toFixed(5)}
                              </span>
                            </>
                          ) : (
                            <span className="muted">No location sent</span>
                          )}
                        </td>
                        <td>{formatDateTime(row.createdAt)}</td>
                        <td>
                          <Link to={`/orders/${encodeURIComponent(row.orderId)}`} style={ID_STYLE}>
                            #{row.orderId.slice(-8).toUpperCase()}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>

      {/* RIDER PAY: what riders are owed, then each payout. The figures used to
          be one long sentence above the table. */}
      <section className="dash-section" aria-labelledby="dispatch-pay">
        <div className="section-head">
          <div>
            <h2 id="dispatch-pay" className="section-title">
              Rider pay
            </h2>
            {payouts.data ? (
              <p className="section-note">
                Minimum payout {formatCurrency(payouts.data.limits.minPayout)} · up to{' '}
                {formatCurrency(payouts.data.limits.maxPerTransfer)} per transfer ·{' '}
                {formatCurrency(payouts.data.limits.maxPerRiderPerDay)} per rider a day ·{' '}
                {formatCurrency(payouts.data.limits.maxPlatformPerDay)} a day across the platform
              </p>
            ) : null}
          </div>
        </div>

        {payouts.error && <ErrorBanner message={payouts.error} onRetry={payouts.refresh} />}

        {payoutsState === 'loading' ? (
          <div className="card">
            <SkeletonRows count={3} />
          </div>
        ) : payoutsState === 'error' || !payouts.data ? (
          <div className="card">
            <EmptyState
              title="Rider payouts could not be loaded"
              body="The payout ledger could not be read. If rider pay has not been set up yet, this is expected."
            />
          </div>
        ) : (
          <>
            <div className="kpi-grid">
              <KpiCard
                label="Unpaid earnings"
                value={formatCurrency(payouts.data.totals.pendingEarnings)}
                caption="Earned, not yet paid out"
              />
              <KpiCard
                label="Being paid out"
                value={formatCurrency(payouts.data.totals.processingEarnings)}
                caption="In a transfer that hasn't settled"
              />
              <KpiCard
                label="Riders with a payout account"
                value={formatNumber(payouts.data.totals.ridersWithRecipient)}
                caption={summary ? `Of ${formatNumber(summary.total)} riders` : null}
              />
              <KpiCard
                label="Automatic payouts"
                value={payouts.data.autoPayoutsEnabled ? 'On' : 'Off'}
                caption="Feature flag rider_auto_payouts"
              />
            </div>

            {payouts.data.heldRiders.length > 0 ? (
              <div className="card">
                <div className="card-title-row">
                  <h3 className="card-title">Payouts on hold ({formatNumber(payouts.data.heldRiders.length)})</h3>
                </div>
                <div>
                  {payouts.data.heldRiders.map((rider) => (
                    <div key={rider.riderId} className="list-row">
                      <span className="cell-strong">{rider.displayName ?? rider.riderId.slice(-6).toUpperCase()}</span>
                      <span className="muted">
                        {humanizeStatus(rider.holdReason)}
                        {rider.holdUntil ? ` · until ${formatDateTime(rider.holdUntil)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="card">
              <div className="card-title-row">
                <h3 className="card-title">Payouts</h3>
              </div>
              {payouts.data.payouts.length === 0 ? (
                <EmptyState title="No payouts yet" body="No rider payout has been created." />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Rider</th>
                        <th className="num">Amount</th>
                        <th>Status</th>
                        <th className="num">Earnings</th>
                        <th>Reference</th>
                        <th>Created</th>
                        <th>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.data.payouts.map((payout) => (
                        <tr key={payout.id}>
                          <td className="cell-strong">{payout.riderName ?? payout.riderId.slice(-6).toUpperCase()}</td>
                          <td className="cell-amount">{formatCurrency(payout.amount)}</td>
                          <td>
                            <StatusBadge label={payout.status} tone={payoutTone(payout.status)} />
                            {payout.failureReason ? <div className="muted">{payout.failureReason}</div> : null}
                          </td>
                          <td className="num">{formatNumber(payout.earningCount)}</td>
                          <td style={ID_STYLE}>{payout.reference}</td>
                          <td className="muted">{formatDateTime(payout.createdAt)}</td>
                          <td className="muted">{payout.paidAt ? formatDateTime(payout.paidAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* RIDERS: who they are, then the deliveries they were given. */}
      <section className="dash-section" aria-labelledby="dispatch-riders">
        <div className="section-head">
          <h2 id="dispatch-riders" className="section-title">
            Riders and assignments
          </h2>
        </div>

        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">Rider roster</h3>
          </div>

          {roster.error && <ErrorBanner message={roster.error} onRetry={roster.refresh} />}

          {rosterState === 'loading' ? (
            <SkeletonRows count={4} />
          ) : rosterState === 'error' ? (
            <EmptyState
              title="Rider roster could not be loaded"
              body="The read failed, so nothing can be said about riders yet. Retry from the banner above."
            />
          ) : roster.data!.riders.length === 0 ? (
            <EmptyState title="No riders" body="No dispatch riders are on record yet." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th>Status</th>
                    <th>Zone</th>
                    <th>Vehicle</th>
                    <th className="num">Active load</th>
                    <th className="num">Completed trips</th>
                    <th className="num">Acceptance</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.data!.riders.map((rider) => (
                    <tr key={rider.id}>
                      <td>
                        <span className="cell-strong">{rider.displayName}</span>
                        <div className="muted" style={ID_STYLE}>
                          {rider.id.slice(-6).toUpperCase()}
                        </div>
                      </td>
                      <td>
                        <StatusBadge label={rider.status} tone={rider.status.toLowerCase() === 'available' ? 'success' : 'neutral'} />
                        {rider.verificationStatus.toLowerCase() !== 'approved' ? (
                          <StatusBadge label={rider.verificationStatus} tone="warning" />
                        ) : null}
                      </td>
                      <td>{rider.zone ?? '—'}</td>
                      <td>{humanizeStatus(rider.vehicleType)}</td>
                      <td className="num">{formatNumber(rider.activeLoad)}</td>
                      <td className="num">{formatNumber(rider.completedTrips)}</td>
                      <td className="num">{rider.acceptanceRate === null ? '—' : `${Math.round(rider.acceptanceRate)}%`}</td>
                      <td>
                        {rider.online ? <StatusBadge label="online" tone="success" /> : formatDateTime(rider.lastSeenAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Every delivery still with a rider, oldest assignment first (the
            longest on the road is the likeliest to be stuck). `inProgress` is
            missing from an older server during a deploy, in which case the
            card says so instead of claiming there are none. */}
        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">On the road now</h3>
            <span className="muted">Rider assigned, not yet delivered · oldest first</span>
          </div>

          {opsState === 'loading' ? (
            <SkeletonRows count={3} />
          ) : opsState === 'ready' && ops.data!.inProgress === undefined ? (
            <p className="muted">Not available yet</p>
          ) : opsState === 'empty' || (opsState === 'ready' && ops.data!.inProgress!.length === 0) ? (
            <EmptyState title="No deliveries in progress" body="No order is with a FEASTY rider right now." />
          ) : opsState === 'ready' ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Restaurant</th>
                    <th>Courier</th>
                    <th>Assigned at</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.data!.inProgress!.map((row) => (
                    <tr key={row.orderId}>
                      <td>
                        <Link to={`/orders/${encodeURIComponent(row.orderId)}`} style={ID_STYLE}>
                          #{row.orderId.slice(-8).toUpperCase()}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge label={humanizeStatus(row.status)} tone={getOrderTone(row.status)} />
                      </td>
                      <td>{row.restaurantName ?? '—'}</td>
                      <td>{row.courierName ?? row.courierId?.slice(-6).toUpperCase() ?? '—'}</td>
                      <td className="muted">{formatDateTime(row.assignedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Titled "Active assignments" before, but the read is the 50 most
            recent assignments in any state, delivered ones included, and it
            carries no order status to tell them apart. The title now says what
            it is. "Dispatch owner" repeated the courier on every row (the owner
            is set to the courier), so it shows only when the two differ. */}
        <div className="card">
          <div className="card-title-row">
            <h3 className="card-title">Recent assignments</h3>
            <span className="muted">The 50 most recent, delivered ones included</span>
          </div>

          {opsState === 'loading' ? (
            <SkeletonRows count={4} />
          ) : opsState === 'empty' || (opsState === 'ready' && ops.data!.activeAssignments.length === 0) ? (
            <EmptyState title="No assignments yet" body="No order has been given to a FEASTY rider yet." />
          ) : opsState === 'ready' ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Courier</th>
                    <th>Assigned at</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.data!.activeAssignments.map((row) => {
                    const owner = distinctOwner(row);
                    return (
                      <tr key={row.orderId}>
                        <td>
                          <Link to={`/orders/${encodeURIComponent(row.orderId)}`} style={ID_STYLE}>
                            #{row.orderId.slice(-8).toUpperCase()}
                          </Link>
                        </td>
                        <td>
                          {row.courierName ?? row.courierId?.slice(-6).toUpperCase() ?? '—'}
                          {owner ? (
                            <div className="muted">Owner: {riderLabelFor(owner).label}</div>
                          ) : null}
                        </td>
                        <td className="muted">{formatDateTime(row.assignedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
