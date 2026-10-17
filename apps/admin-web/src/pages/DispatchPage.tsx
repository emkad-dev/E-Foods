import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import { formatDateTime } from '../lib/format';
import {
  getAdminDispatchOpsView,
  type AdminDispatchOpsView,
} from '../services/platformReads';

export default function DispatchPage() {
  const [data, setData] = useState<AdminDispatchOpsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAdminDispatchOpsView();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dispatch ops right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Active assignments</h3>
          <button className="button-ghost" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>

        {loading ? (
          <SkeletonRows count={4} />
        ) : !data || data.activeAssignments.length === 0 ? (
          <EmptyState title="No active assignments" body="No courier assignments are on record yet." />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Courier</th>
                  <th>Dispatch owner</th>
                  <th>Assigned at</th>
                </tr>
              </thead>
              <tbody>
                {data.activeAssignments.map((row) => (
                  <tr key={row.orderId}>
                    <td className="mono">{row.orderId.slice(-8).toUpperCase()}</td>
                    <td>{row.courierName ?? row.courierId?.slice(-6).toUpperCase() ?? '—'}</td>
                    <td className="mono">{row.dispatchOwnerId?.slice(-6).toUpperCase() ?? '—'}</td>
                    <td>{formatDateTime(row.assignedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title-row">
          <h3 className="card-title">SOS events (last 24h)</h3>
        </div>

        {loading ? (
          <SkeletonRows count={3} />
        ) : !data || data.sosEvents.length === 0 ? (
          <EmptyState title="No SOS events" body="No rider SOS alerts in the last 24 hours." />
        ) : (
          <div className="table-scroll">
            <table className="table">
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
                {data.sosEvents.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.orderId.slice(-8).toUpperCase()}</td>
                    <td className="mono">
                      {row.actorUid?.slice(-6).toUpperCase() ?? '—'}
                    </td>
                    <td>{(row.details?.latitude as number | null | undefined) ?? '—'}</td>
                    <td>{(row.details?.longitude as number | null | undefined) ?? '—'}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
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
