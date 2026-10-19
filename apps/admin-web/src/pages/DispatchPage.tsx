import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime, formatNumber } from '../lib/format';
import { usePolledRpc } from '../lib/usePolledRpc';
import { resolveViewState } from '../lib/viewState';
import { getAdminDispatchOpsView, getAdminRiderRoster } from '../services/platformReads';

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
    </div>
  );
}
