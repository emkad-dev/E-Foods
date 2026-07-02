import { useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { usePolledRpc } from '../lib/usePolledRpc';
import {
  reviewDispatchApplication,
  reviewPartnerApplication,
  updateRestaurantApproval,
} from '../services/approvalActions';
import { getAdminApprovalQueue } from '../services/platformReads';
import { getApplicationTone, getApprovalTone } from '../theme/tones';

export default function ApprovalsPage() {
  const { data, loading, error, refresh } = usePolledRpc(getAdminApprovalQueue);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const restaurants = useMemo(
    () =>
      [...(data?.restaurants ?? [])].sort((left, right) => {
        const leftPublished = left.isPublished === true ? 1 : 0;
        const rightPublished = right.isPublished === true ? 1 : 0;

        if (leftPublished !== rightPublished) {
          return leftPublished - rightPublished;
        }

        return left.name.localeCompare(right.name);
      }),
    [data?.restaurants]
  );

  const partnerApplications = useMemo(
    () => (data?.partnerApplications ?? []).filter((application) => application.status === 'pending'),
    [data?.partnerApplications]
  );

  const dispatchApplications = useMemo(
    () => (data?.dispatchApplications ?? []).filter((application) => application.status === 'pending'),
    [data?.dispatchApplications]
  );

  const runAction = async (id: string, action: () => Promise<unknown>) => {
    setPendingId(id);
    setActionError(null);

    try {
      await action();
      await refresh();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'The action failed. Try again.');
    } finally {
      setPendingId(null);
    }
  };

  const rejectWithReason = (id: string, review: (reason?: string) => Promise<unknown>) => {
    const reason = window.prompt('Rejection reason (optional):') ?? undefined;
    void runAction(id, () => review(reason?.trim() ? reason.trim() : undefined));
  };

  return (
    <div className="page">
      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {loading ? <LoadingBlock label="Loading approval queues…" /> : null}

      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Partner applications</h3>
          <span className="badge badge-warning">{partnerApplications.length} pending</span>
        </div>
        {partnerApplications.length === 0 ? (
          <EmptyState title="No pending partner applications" body="New restaurant partner requests will land here." />
        ) : (
          partnerApplications.map((application) => (
            <div key={application.id} className="list-row">
              <div>
                <div className="list-row-title">{application.restaurantName}</div>
                <div className="list-row-sub">
                  {application.contactName} · {application.email} · {application.cuisine}
                </div>
                <div className="list-row-sub">{application.address}</div>
              </div>
              <div className="row-actions">
                <StatusBadge label={application.status} tone={getApplicationTone(application.status)} />
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={pendingId === application.id}
                  onClick={() =>
                    void runAction(application.id, () =>
                      reviewPartnerApplication({ applicationId: application.id, decision: 'approve' })
                    )
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={pendingId === application.id}
                  onClick={() =>
                    rejectWithReason(application.id, (rejectionReason) =>
                      reviewPartnerApplication({ applicationId: application.id, decision: 'reject', rejectionReason })
                    )
                  }
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Dispatch applications</h3>
          <span className="badge badge-warning">{dispatchApplications.length} pending</span>
        </div>
        {dispatchApplications.length === 0 ? (
          <EmptyState title="No pending dispatch applications" body="New rider applications will land here." />
        ) : (
          dispatchApplications.map((application) => (
            <div key={application.id} className="list-row">
              <div>
                <div className="list-row-title">{application.displayName}</div>
                <div className="list-row-sub">
                  {application.email} · {application.vehicleType} · {application.region} / {application.lga}
                </div>
              </div>
              <div className="row-actions">
                <StatusBadge label={application.status} tone={getApplicationTone(application.status)} />
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={pendingId === application.id}
                  onClick={() =>
                    void runAction(application.id, () =>
                      reviewDispatchApplication({ applicationId: application.id, decision: 'approve' })
                    )
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={pendingId === application.id}
                  onClick={() =>
                    rejectWithReason(application.id, (rejectionReason) =>
                      reviewDispatchApplication({ applicationId: application.id, decision: 'reject', rejectionReason })
                    )
                  }
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Restaurant publishing</h3>
          <span className="badge badge-warning">
            {restaurants.filter((restaurant) => restaurant.isPublished !== true).length} unpublished
          </span>
        </div>
        {restaurants.length === 0 ? (
          <EmptyState title="No restaurants yet" body="Partner restaurants will appear here once created." />
        ) : (
          restaurants.map((restaurant) => (
            <div key={restaurant.id} className="list-row">
              <div>
                <div className="list-row-title">{restaurant.name}</div>
                <div className="list-row-sub">{restaurant.address ?? 'Address pending'}</div>
              </div>
              <div className="row-actions">
                <StatusBadge
                  label={restaurant.approvalStatus ?? (restaurant.isPublished === true ? 'approved' : 'pending')}
                  tone={getApprovalTone(restaurant.approvalStatus, restaurant.isPublished)}
                />
                {restaurant.isPublished === true ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pendingId === restaurant.id}
                    onClick={() =>
                      void runAction(restaurant.id, () =>
                        updateRestaurantApproval({ restaurantId: restaurant.id, isPublished: false })
                      )
                    }
                  >
                    Unpublish
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    disabled={pendingId === restaurant.id}
                    onClick={() =>
                      void runAction(restaurant.id, () =>
                        updateRestaurantApproval({ restaurantId: restaurant.id, isPublished: true })
                      )
                    }
                  >
                    Publish
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
