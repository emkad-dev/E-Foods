import { useMemo } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import KpiCard from '../components/KpiCard';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { formatCurrency, formatDateTime, formatNumber } from '../lib/format';
import { usePolledRpc } from '../lib/usePolledRpc';
import { resolveViewState } from '../lib/viewState';
import { getAdminRestaurantPayouts, type RestaurantPayoutRow } from '../services/platformReads';
import type { AdminTone } from '../theme/tones';

/**
 * RESTAURANT PAYOUT VISIBILITY.
 *
 * A payment is split to the restaurant only when the restaurant has a Paystack
 * subaccount. Without one the platform receives the whole payment ("manual"
 * settlement) and must pay the restaurant out by hand. Nothing in the console
 * showed which restaurants were in that state, so a published restaurant could
 * take orders for weeks while its money sat with the platform.
 */

const payoutTone = (status: string): AdminTone => {
  switch (status.toLowerCase()) {
    case 'active':
      return 'success';
    case 'failed':
      return 'danger';
    case 'none':
      return 'neutral';
    default:
      return 'warning';
  }
};

const payoutLabel = (status: string) => (status === 'none' ? 'No payout profile' : status);

const sortRows = (rows: RestaurantPayoutRow[]) =>
  [...rows].sort((a, b) => {
    if (a.notSplitting !== b.notSplitting) {
      return a.notSplitting ? -1 : 1;
    }
    if (a.isPublished !== b.isPublished) {
      return a.isPublished ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

export default function RestaurantsPage() {
  const { data, error, refresh, loading } = usePolledRpc(getAdminRestaurantPayouts);
  const viewState = resolveViewState({ hasData: data !== null, error });

  const rows = useMemo(() => sortRows(data?.restaurants ?? []), [data]);
  const notSplittingCount = rows.filter((row) => row.notSplitting).length;
  const windowDays = data?.windowDays ?? 30;

  return (
    <div className="page">
      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

      {viewState === 'ready' && data ? (
        <div className="kpi-grid">
          <KpiCard
            label="Published, not splitting"
            value={formatNumber(notSplittingCount)}
            caption="Platform holds their money"
          />
          <KpiCard
            label={`Paid manually (${windowDays}d)`}
            value={formatCurrency(data.platformSettlement.manualAmount)}
            caption={`${formatNumber(data.platformSettlement.manualCount)} payments held by the platform`}
          />
          <KpiCard
            label={`Paid with split (${windowDays}d)`}
            value={formatCurrency(data.platformSettlement.splitAmount)}
            caption={`${formatNumber(data.platformSettlement.splitCount)} payments split at source`}
          />
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title-row">
          <h3 className="card-title">Restaurant payouts</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>

        {viewState === 'loading' ? (
          <SkeletonRows count={5} />
        ) : viewState === 'error' ? (
          <EmptyState
            title="Payout data could not be loaded"
            body="The read failed, so nothing can be said about restaurant payouts yet. Retry from the banner above."
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No restaurants" body="No restaurants are on record yet." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Restaurant</th>
                  <th>Status</th>
                  <th>Paystack subaccount</th>
                  <th>Payout profile</th>
                  <th>Manual ({windowDays}d)</th>
                  <th>Split ({windowDays}d)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.notSplitting ? (
                        <div style={{ marginTop: 6 }}>
                          <span
                            className="badge badge-danger"
                            style={{ whiteSpace: 'normal' }}
                            title="Customers can pay this restaurant, but with no Paystack subaccount every payment goes to the platform."
                          >
                            Published but not splitting - platform is holding this restaurant&apos;s money
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge label={row.isPublished ? 'published' : 'unpublished'} tone={row.isPublished ? 'success' : 'neutral'} />
                      {row.isPaused ? (
                        <span className="badge badge-warning" title={`Paused until ${formatDateTime(row.pausedUntil)}`}>
                          Paused
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge
                        label={row.hasSubaccount ? 'present' : 'missing'}
                        tone={row.hasSubaccount ? 'success' : row.isPublished ? 'danger' : 'neutral'}
                      />
                    </td>
                    <td>
                      <StatusBadge label={payoutLabel(row.payoutStatus)} tone={payoutTone(row.payoutStatus)} />
                      {row.payoutLastError ? (
                        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                          {row.payoutLastError}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {formatNumber(row.settlement.manualCount)} · {formatCurrency(row.settlement.manualAmount)}
                    </td>
                    <td>
                      {formatNumber(row.settlement.splitCount)} · {formatCurrency(row.settlement.splitAmount)}
                      {row.settlement.unknownCount > 0 ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          +{formatNumber(row.settlement.unknownCount)} with no recorded mode
                        </div>
                      ) : null}
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
