import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { formatCurrency, formatDateTime, formatNumber, humanizeStatus } from '../lib/format';
import { usePolledRpc } from '../lib/usePolledRpc';
import { resolveViewState } from '../lib/viewState';
import { getAdminDispatchOpsView, getAdminRiderPayouts, getAdminRiderRoster } from '../services/platformReads';
import type { AdminTone } from '../theme/tones';

const ID_STYLE: React.CSSProperties = { fontFamily: 'monospace', fontSize: '12px' };

// SOS coordinates arrive in an untyped details bag. A value counts only if it
// is a finite number inside the valid range; anything else is "no location",
// never a map link to 0,0.
const toCoordinate = (value: unknown, limit: number): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

export default function DispatchPage() {
  const { data, error, refresh, refreshing } = usePolledRpc(getAdminDispatchOpsView);
  // A separate read: a failed roster must not blank the assignments/SOS panels
  // (and vice versa), so each carries its own view state.
  const roster = usePolledRpc(getAdminRiderRoster);

  const viewState = resolveViewState({ hasData: data !== null, error });
  const rosterState = resolveViewState({ hasData: roster.data !== null, error: roster.error });

  return (
    <div className="page">
      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {/* SOS first. A rider asking for help is the most urgent thing on this
          page, and each row now says who, where and on which order, with the
          map and the order one click away. It used to be the second card, with
          a 6-character rider code, bare coordinates and a plain-text order id.
          The Refresh button moved up with it: it reloads both cards. */}
      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">SOS events (last 24h)</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {viewState === 'loading' ? (
          <SkeletonRows count={3} />
        ) : viewState === 'empty' || (viewState === 'ready' && data!.sosEvents.length === 0) ? (
          <EmptyState title="No SOS events" body="No rider SOS alerts in the last 24 hours." />
        ) : viewState === 'ready' ? (
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
                {data!.sosEvents.map((row) => {
                  // The roster carries names but no phone numbers, so a name
                  // is the most this row can say about who; it falls back to
                  // the short code until the roster has loaded.
                  const rider = roster.data?.riders.find((entry) => entry.id === row.actorUid) ?? null;
                  const riderLabel = rider?.displayName ?? row.actorUid?.slice(-6).toUpperCase() ?? 'Unknown rider';
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

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title-row">
          <h3 className="card-title">Active assignments</h3>
        </div>

        {viewState === 'loading' ? (
          <SkeletonRows count={4} />
        ) : viewState === 'empty' || (viewState === 'ready' && data!.activeAssignments.length === 0) ? (
          <EmptyState title="No active assignments" body="No courier assignments are on record yet." />
        ) : viewState === 'ready' ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Courier</th>
                  <th>Dispatch owner</th>
                  <th>Assigned at</th>
                </tr>
              </thead>
              <tbody>
                {data!.activeAssignments.map((row) => (
                  <tr key={row.orderId}>
                    <td style={ID_STYLE}>{row.orderId.slice(-8).toUpperCase()}</td>
                    <td>{row.courierName ?? row.courierId?.slice(-6).toUpperCase() ?? '—'}</td>
                    <td style={ID_STYLE}>{row.dispatchOwnerId?.slice(-6).toUpperCase() ?? '—'}</td>
                    <td>{formatDateTime(row.assignedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title-row">
          <h3 className="card-title">Rider roster</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={roster.refresh} disabled={roster.refreshing}>
            {roster.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
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
                  <th>Active load</th>
                  <th>Completed trips</th>
                  <th>Acceptance</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {roster.data!.riders.map((rider) => (
                  <tr key={rider.id}>
                    <td>
                      {rider.displayName}
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
                    <td>{rider.vehicleType}</td>
                    <td>{formatNumber(rider.activeLoad)}</td>
                    <td>{formatNumber(rider.completedTrips)}</td>
                    <td>{rider.acceptanceRate === null ? '—' : `${Math.round(rider.acceptanceRate)}%`}</td>
                    <td>
                      {rider.online ? <StatusBadge label="online" tone="success" /> : null}
                      {rider.online ? null : formatDateTime(rider.lastSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RiderPayoutsCard />
    </div>
  );
}

const payoutTone = (status: string): AdminTone =>
  status === 'paid' ? 'success' : status === 'processing' ? 'info' : status === 'failed' || status === 'reversed' ? 'danger' : 'neutral';

/**
 * Rider pay: read-only view of the Paystack payout ledger. Its own polled read
 * so a payout-ledger failure (e.g. the migration not applied yet) cannot blank
 * the dispatch panels above.
 */
function RiderPayoutsCard() {
  const payouts = usePolledRpc(getAdminRiderPayouts);
  const state = resolveViewState({ hasData: payouts.data !== null, error: payouts.error });
  const data = payouts.data;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title-row">
        <h3 className="card-title">Rider payouts</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={payouts.refresh} disabled={payouts.refreshing}>
          {payouts.refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {payouts.error && <ErrorBanner message={payouts.error} onRetry={payouts.refresh} />}

      {state === 'loading' ? (
        <SkeletonRows count={3} />
      ) : state === 'error' || !data ? (
        <EmptyState
          title="Rider payouts could not be loaded"
          body="The payout ledger could not be read. If rider pay has not been set up yet, this is expected."
        />
      ) : (
        <>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            Automatic payouts are{' '}
            <StatusBadge label={data.autoPayoutsEnabled ? 'on' : 'off'} tone={data.autoPayoutsEnabled ? 'success' : 'neutral'} />{' '}
            (feature flag <code>rider_auto_payouts</code>). Unpaid earnings {formatCurrency(data.totals.pendingEarnings)}, in
            flight {formatCurrency(data.totals.processingEarnings)}, riders with a payout account{' '}
            {formatNumber(data.totals.ridersWithRecipient)}. Minimum payout {formatCurrency(data.limits.minPayout)}, max per
            transfer {formatCurrency(data.limits.maxPerTransfer)}, platform daily cap{' '}
            {formatCurrency(data.limits.maxPlatformPerDay)}.
          </p>

          {data.heldRiders.length > 0 ? (
            <p className="muted" style={{ margin: '0 0 12px' }}>
              Held:{' '}
              {data.heldRiders
                .map((rider) => `${rider.displayName ?? rider.riderId.slice(-6).toUpperCase()} (${humanizeStatus(rider.holdReason)})`)
                .join(', ')}
            </p>
          ) : null}

          {data.payouts.length === 0 ? (
            <EmptyState title="No payouts yet" body="No rider payout has been created." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Earnings</th>
                    <th>Reference</th>
                    <th>Created</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.map((payout) => (
                    <tr key={payout.id}>
                      <td>{payout.riderName ?? payout.riderId.slice(-6).toUpperCase()}</td>
                      <td>{formatCurrency(payout.amount)}</td>
                      <td>
                        <StatusBadge label={payout.status} tone={payoutTone(payout.status)} />
                        {payout.failureReason ? <div className="muted">{payout.failureReason}</div> : null}
                      </td>
                      <td>{formatNumber(payout.earningCount)}</td>
                      <td style={ID_STYLE}>{payout.reference}</td>
                      <td>{formatDateTime(payout.createdAt)}</td>
                      <td>{payout.paidAt ? formatDateTime(payout.paidAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
