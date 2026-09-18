import { useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import PartnerOnboardingReview from '../components/PartnerOnboardingReview';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime } from '../lib/format';
import { usePolledRpc } from '../lib/usePolledRpc';
import {
  reviewDispatchApplication,
  reviewPartnerApplication,
  setRestaurantPublished,
} from '../services/approvalActions';
import { getAdminApprovalQueue } from '../services/platformReads';
import { resolveViewState } from '../lib/viewState';
import { getApplicationTone, getApprovalTone } from '../theme/tones';

/** The common shape of both review RPCs' replies; `restaurantId` is partner-only. */
type ReviewResult = {
  approvedByUid: string | null;
  decision: 'approve' | 'reject';
  restaurantId?: string | null;
  role: string;
  tokenRefreshRequired: boolean;
};

/**
 * Both review RPCs answer with what the server actually did, and every field
 * of that answer was thrown away -- the screen's only report was the row
 * vanishing from the queue. `tokenRefreshRequired` is the expensive one: an
 * approved partner's new role does not reach their app until they sign out
 * and back in, so without it the operator marks the job done and the partner
 * reports that the approval "didn't work". `restaurantId` and `approvedByUid`
 * are the server's record of what it created and whom it recorded it against,
 * which is worth reading back once -- not least to catch a decision attributed
 * to the wrong admin.
 *
 * This is a transient confirmation of the action just taken, deliberately not
 * an audit trail; whether the console needs a persistent one is the owner's
 * call, not this function's.
 */
const describeReview = (result: ReviewResult) =>
  [
    result.decision === 'approve' ? `Approved — the account is now ${result.role}.` : 'Rejected.',
    result.restaurantId ? `Restaurant ${result.restaurantId}.` : null,
    result.approvedByUid ? `Recorded against ${result.approvedByUid}.` : null,
    result.tokenRefreshRequired
      ? 'They must sign out and back in before the new role reaches their app.'
      : null,
  ]
    .filter(Boolean)
    .join(' ');

const formatVehicleLine = (application: {
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehiclePlateNumber?: string | null;
}) => {
  const parts = [application.vehicleMake, application.vehicleModel].filter(Boolean);
  const label = parts.length > 0 ? parts.join(' ') : 'Vehicle details pending';
  return `${label}${application.vehiclePlateNumber ? ` · ${application.vehiclePlateNumber}` : ''}`;
};

/**
 * Warning tone only when the number means work.
 *
 * Amber is the console saying "look at this". A queue at zero is the opposite
 * of that, and rendering it amber spends the operator's attention on good
 * news -- which makes the amber that DOES matter worth less.
 */
const countBadgeClass = (count: number) => `badge ${count > 0 ? 'badge-warning' : 'badge-neutral'}`;

export default function ApprovalsPage() {
  const { data, error, refresh } = usePolledRpc(getAdminApprovalQueue);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

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

  const unpublishedCount = useMemo(
    () => restaurants.filter((restaurant) => restaurant.isPublished !== true).length,
    [restaurants]
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
    setReviewNotice(null);

    try {
      await action();
      await refresh();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'The action failed. Try again.');
    } finally {
      setPendingId(null);
    }
  };

  const runReview = (id: string, review: () => Promise<ReviewResult>) =>
    void runAction(id, async () => {
      setReviewNotice(describeReview(await review()));
    });

  // This screen's entire job is to report whether work is waiting, so
  // "No pending partner applications" is the most expensive sentence in the
  // console to get wrong: an admin who reads it during the 120s poll's first
  // fetch, or after one that failed, walks away from a queue that may be
  // full. `usePolledRpc` leaves `data` as null in both cases, which is the
  // honest signal -- the three `?? []` fallbacks below are what turned it
  // into "nothing to review". Nothing renders until the queue really arrives.
  const dataState = resolveViewState({ hasData: data !== null, error });

  const rejectWithReason = (id: string, review: (reason?: string) => Promise<ReviewResult>) => {
    const reason = window.prompt('Rejection reason (optional):');

    // `null` is Cancel/Esc; '' is "rejected, no reason given". Coalescing the
    // two -- which `?? undefined` did -- meant dismissing the prompt REJECTED
    // the application anyway.
    if (reason === null) {
      return;
    }

    runReview(id, () => review(reason.trim() ? reason.trim() : undefined));
  };

  return (
    <div className="page">
      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {reviewNotice ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {reviewNotice}
          </p>
        </div>
      ) : null}
      {dataState === 'loading' ? <SkeletonRows count={5} /> : null}

      {/* A count badge is warning-toned only when there is something to act on.
          All three of these were `badge-warning` unconditionally, so a clear
          queue announced itself in amber -- three times, on the first screen an
          operator opens, saying "attention needed" while the card underneath
          said "nothing here". Seen by looking at it; no measurement finds this. */}
      {dataState === 'ready' ? (
        <>
          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Partner applications</h3>
              <span className={countBadgeClass(partnerApplications.length)}>{partnerApplications.length} pending</span>
            </div>
            {partnerApplications.length === 0 ? (
              <EmptyState title="No pending partner applications" body="New restaurant partner requests will land here." />
            ) : (
              partnerApplications.map((application) => (
                <div key={application.id} className="list-row">
                  <div>
                    <div className="list-row-title">{application.restaurantName}</div>
                    {/* phoneNumber and submittedAt ride in on every row of
                        this queue and neither was shown: the operator had no
                        way to reach the applicant from the screen that asks
                        them to judge the application, and no way to see that
                        a request had been sitting here for a week. */}
                    <div className="list-row-sub">
                      {application.contactName} · {application.email} · {application.phoneNumber} ·{' '}
                      {application.cuisine}
                    </div>
                    <div className="list-row-sub">{application.address}</div>
                    <div className="list-row-sub">Submitted {formatDateTime(application.submittedAt)}</div>
                    <PartnerOnboardingReview review={application.onboarding} />
                  </div>
                  <div className="row-actions">
                    <StatusBadge label={application.status} tone={getApplicationTone(application.status)} />
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      disabled={pendingId === application.id}
                      onClick={() =>
                        runReview(application.id, () =>
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
              <span className={countBadgeClass(dispatchApplications.length)}>{dispatchApplications.length} pending</span>
            </div>
            {dispatchApplications.length === 0 ? (
              <EmptyState title="No pending dispatch applications" body="New rider applications will land here." />
            ) : (
              dispatchApplications.map((application) => (
                <div key={application.id} className="list-row">
                  <div>
                    <div className="list-row-title">{application.displayName}</div>
                    <div className="list-row-sub">
                      {application.email} · {application.phoneNumber} · {application.vehicleType} ·{' '}
                      {application.region} / {application.lga}
                    </div>
                    <div className="list-row-sub">{formatVehicleLine(application)}</div>
                    <div className="list-row-sub">
                      Licence {application.licenseNumber ?? 'pending'} · Docs{' '}
                      {application.licenceFrontPath && application.licenceBackPath ? 'captured' : 'missing'}
                    </div>
                    <div className="list-row-sub">Submitted {formatDateTime(application.submittedAt)}</div>
                  </div>
                  <div className="row-actions">
                    <StatusBadge label={application.status} tone={getApplicationTone(application.status)} />
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      disabled={pendingId === application.id}
                      onClick={() =>
                        runReview(application.id, () =>
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
              <span className={countBadgeClass(unpublishedCount)}>
                {unpublishedCount} unpublished
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
                            setRestaurantPublished({ restaurantId: restaurant.id, isPublished: false })
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
                            setRestaurantPublished({ restaurantId: restaurant.id, isPublished: true })
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
        </>
      ) : null}
    </div>
  );
}
