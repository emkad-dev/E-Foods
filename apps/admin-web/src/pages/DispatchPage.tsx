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

export default function DispatchPage() {
  const { data, error, refresh, loading } = usePolledRpc(getAdminDispatchOpsView);
  // A separate read: a failed roster must not blank the assignments/SOS panels
  // (and vice versa), so each carries its own view state.
  const roster = usePolledRpc(getAdminRiderRoster);

  const viewState = resolveViewState({ hasData: data !== null, error });
  const rosterState = resolveViewState({ hasData: roster.data !== null, error: roster.error });

  return (
    <div className="page">
      {error && <ErrorBanner message={error} onRetry={refresh} />}

      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Active assignments</h3>
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
            Refresh
          </button>
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
          <h3 className="card-title">SOS events (last 24h)</h3>
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
                  <th>Order</th>
                  <th>Rider</th>
                  <th>Lat</th>
                  <th>Lng</th>
                  <th>Triggered at</th>
                </tr>
              </thead>
              <tbody>
                {data!.sosEvents.map((row) => (
                  <tr key={row.id}>
                    <td style={ID_STYLE}>{row.orderId.slice(-8).toUpperCase()}</td>
                    <td style={ID_STYLE}>{row.actorUid?.slice(-6).toUpperCase() ?? '—'}</td>
                    <td>{(row.details?.latitude as number | null | undefined) ?? '—'}</td>
                    <td>{(row.details?.longitude as number | null | undefined) ?? '—'}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={roster.refresh} disabled={roster.loading}>
            Refresh
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={payouts.refresh} disabled={payouts.loading}>
          Refresh
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
