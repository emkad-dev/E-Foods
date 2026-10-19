import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import { formatDateTime } from '../lib/format';
import { usePolledRpc } from '../lib/usePolledRpc';
import { resolveViewState } from '../lib/viewState';
import {
  getAdminDispatchOpsView,
} from '../services/platformReads';

const ID_STYLE: React.CSSProperties = { fontFamily: 'monospace', fontSize: '12px' };

export default function DispatchPage() {
  const { data, error, refresh, loading } = usePolledRpc(getAdminDispatchOpsView);

  const viewState = resolveViewState({ hasData: data !== null, error });

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
    </div>
  );
}
