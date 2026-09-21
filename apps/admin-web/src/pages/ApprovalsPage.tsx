import { useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import PartnerOnboardingReview from '../components/PartnerOnboardingReview';
import RestaurantRating from '../components/RestaurantRating';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime } from '../lib/format';
import { resolveKycGate, type KycDocumentKey } from '../lib/kycReviewGate';
import { countNewSince, isNewSince, useLastVisit } from '../lib/lastVisit';
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
 * The marker for a row that was not here last time.
 *
 * The word "New" is the affordance, not the colour. A badge that signalled
 * only in teal would be invisible to a screen reader and ambiguous to a
 * colourblind operator -- and this console already draws neutral, warning and
 * info badges on the same rows, so hue alone was never going to carry it. The
 * hidden half of the label supplies the context the visible word leaves out:
 * "New" on its own could plausibly mean a status.
 *
 * Deliberately static. An animation here would pull the eye on a screen whose
 * whole job is to be read carefully, and would replay on every poll.
 */
const NewSinceMarker = ({ label }: { label: string }) => (
  <span className="badge badge-info">
    {label}
    <span className="sr-only"> since your last visit</span>
  </span>
);

/**
 * Warning tone only when the number means work.
 *
 * Amber is the console saying "look at this". A queue at zero is the opposite
 * of that, and rendering it amber spends the operator's attention on good
 * news -- which makes the amber that DOES matter worth less.
 */
const countBadgeClass = (count: number) => `badge ${count > 0 ? 'badge-warning' : 'badge-neutral'}`;

/**
 * What the operator is agreeing to when they approve a partner.
 *
 * Approving is the less reversible of the two decisions on this row and it was
 * the one that asked nothing: Reject stopped to collect a reason, Approve
 * fired on the first click. Rejecting a partner after the fact does not undo a
 * payment their customers have already made, so the confirmation names the
 * consequence rather than asking "are you sure".
 *
 * It also states the limit of the document gate below, in the same breath as
 * the decision it is gating -- the console knows the KYC links were opened and
 * cannot know they were read, and the one moment that distinction matters is
 * this one.
 */
const partnerApprovalPrompt = (application: { contactName: string; restaurantName: string }) =>
  [
    `Approve ${application.restaurantName} (${application.contactName})?`,
    'This makes the account a restaurant partner and puts the payout details it submitted on the live money path. Rejecting later does not undo payments taken in the meantime.',
    'The console has recorded that the KYC documents were opened. It cannot record that they were read.',
  ].join('\n\n');

const dispatchApprovalPrompt = (application: { displayName: string; email: string }) =>
  [
    `Approve ${application.displayName} (${application.email})?`,
    'This makes the account a dispatch rider: it can accept delivery offers and see customer addresses and phone numbers.',
  ].join('\n\n');

export default function ApprovalsPage() {
  const { data, error, refresh } = usePolledRpc(getAdminApprovalQueue);

  /**
   * The instant this admin last LEFT this page, read once on mount. Rows that
   * arrived after it get a marker, so the visit can start with "these three
   * are the ones I have not seen" instead of re-reading the whole queue. Null
   * on a first visit and on any browser where storage is unavailable, and in
   * both cases nothing is marked -- see lib/lastVisit.ts for why that is the
   * deliberate answer rather than a fallback.
   */
  const previousVisit = useLastVisit('approvals');

  /**
   * When the queue below last actually arrived. `usePolledRpc` hands back a
   * fresh object on every SUCCESSFUL read and leaves the previous one in place
   * when a read fails, so a change of reference is the one honest signal that
   * the data on screen is current. An empty queue is a claim, and this is the
   * timestamp that makes it checkable rather than merely reassuring.
   */
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  useEffect(() => {
    if (data !== null) {
      setLastLoadedAt(Date.now());
    }
  }, [data]);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

  /**
   * Which KYC documents the reviewer has opened, per application, for the life
   * of this mount. Session-scoped on purpose: it is a guard against approving
   * a partner nobody looked at, not a record of who reviewed what, and writing
   * it to a backend would turn a client-side nudge into an audit claim it
   * cannot support. A reload clears it and asks again, which is the correct
   * behaviour for something measuring what THIS reviewer did just now.
   */
  const [openedKycDocuments, setOpenedKycDocuments] = useState<Record<string, KycDocumentKey[]>>({});

  const markKycDocumentOpened = (applicationId: string, document: KycDocumentKey) =>
    setOpenedKycDocuments((previous) => {
      const seen = previous[applicationId] ?? [];
      return seen.includes(document) ? previous : { ...previous, [applicationId]: [...seen, document] };
    });

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

  const newPartnerCount = useMemo(
    () => countNewSince(previousVisit, partnerApplications.map((application) => application.submittedAt)),
    [previousVisit, partnerApplications]
  );

  const newDispatchCount = useMemo(
    () => countNewSince(previousVisit, dispatchApplications.map((application) => application.submittedAt)),
    [previousVisit, dispatchApplications]
  );

  /**
   * Stated as a fact with a time on it rather than an adjective. "Nothing to
   * review" is only worth reading if the reader can tell it is not a stale
   * screen, and the two things they need for that are when it last arrived and
   * whether it will arrive again on its own. The interval itself is
   * deliberately not quoted here -- it lives in usePolledRpc and would drift
   * out of step with this sentence the first time it is tuned.
   */
  const queueFreshness =
    lastLoadedAt === null
      ? undefined
      : `Last checked ${formatDateTime(lastLoadedAt)}. This page rechecks itself while the tab is open.`;

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

  // Deliberately the same kind of dialog Reject already uses -- a native
  // window prompt, blocking, returning a value the caller has to honour. The
  // console does own a nicer <dialog> component (ConfirmDialog, on
  // BroadcastsPage), but introducing it for Approve alone would leave one row
  // with two confirmations of two different shapes, which is how an operator
  // learns to click through both. When this page moves to ConfirmDialog, both
  // decisions move together.
  const approveWithConfirmation = (id: string, prompt: string, review: () => Promise<ReviewResult>) => {
    if (!window.confirm(prompt)) {
      return;
    }

    runReview(id, review);
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
              {/* Wrapped, because `.card-title-row` is space-between: a third
                  child would push the two counts to opposite ends of the
                  header rather than keeping them together. */}
              <span className="flex items-center gap-2">
                {newPartnerCount > 0 ? <NewSinceMarker label={`${newPartnerCount} new`} /> : null}
                <span className={countBadgeClass(partnerApplications.length)}>{partnerApplications.length} pending</span>
              </span>
            </div>
            {partnerApplications.length === 0 ? (
              <EmptyState
                title="You're caught up on partner applications"
                body="Every application that has reached the console has been reviewed. New restaurant sign-ups arrive here as they are submitted."
                note={queueFreshness}
              />
            ) : (
              partnerApplications.map((application) => {
                /**
                 * Approve is the control that puts a stranger's bank details
                 * on the live money path, and nothing on this screen required
                 * the reviewer to have opened the KYC documents sitting three
                 * lines above it. The gate is the smallest honest fix: it
                 * knows the signed links were ACTIVATED in this session, and
                 * it says exactly that -- see lib/kycReviewGate.ts, which also
                 * explains why an application with no documents stays
                 * approvable instead of becoming stuck forever.
                 */
                const kycGate = resolveKycGate(
                  application.onboarding?.documents,
                  openedKycDocuments[application.id] ?? []
                );

                const isNew = isNewSince(previousVisit, application.submittedAt);

                return (
                  <div key={application.id} className="list-row">
                    <div>
                      <div className="list-row-title">
                        {application.restaurantName}
                        {isNew ? (
                          <>
                            {' '}
                            <NewSinceMarker label="New" />
                          </>
                        ) : null}
                      </div>
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
                      <PartnerOnboardingReview
                        review={application.onboarding}
                        onDocumentOpened={(document) => markKycDocumentOpened(application.id, document)}
                      />
                      {/* A disabled control with no stated reason is its own
                          defect, so the gate's reason renders here whether or
                          not it is currently blocking -- next to the links it is
                          talking about, rather than squeezed into the button
                          row. `title` repeats it on the button for anyone who
                          goes to the button first. */}
                      <div className="list-row-sub">
                        {kycGate.blockedReason ? `${kycGate.blockedReason} ${kycGate.note}` : kycGate.note}
                      </div>
                    </div>
                    <div className="row-actions">
                      <StatusBadge label={application.status} tone={getApplicationTone(application.status)} />
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        disabled={pendingId === application.id || kycGate.blockedReason !== undefined}
                        title={kycGate.blockedReason}
                        onClick={() =>
                          approveWithConfirmation(application.id, partnerApprovalPrompt(application), () =>
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
                );
              })
            )}
          </div>

          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Dispatch applications</h3>
              <span className="flex items-center gap-2">
                {newDispatchCount > 0 ? <NewSinceMarker label={`${newDispatchCount} new`} /> : null}
                <span className={countBadgeClass(dispatchApplications.length)}>{dispatchApplications.length} pending</span>
              </span>
            </div>
            {dispatchApplications.length === 0 ? (
              <EmptyState
                title="You're caught up on dispatch applications"
                body="Every rider application that has reached the console has been reviewed. New ones arrive here as riders sign up."
                note={queueFreshness}
              />
            ) : (
              dispatchApplications.map((application) => (
                <div key={application.id} className="list-row">
                  <div>
                    <div className="list-row-title">
                      {application.displayName}
                      {isNewSince(previousVisit, application.submittedAt) ? (
                        <>
                          {' '}
                          <NewSinceMarker label="New" />
                        </>
                      ) : null}
                    </div>
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
                        approveWithConfirmation(application.id, dispatchApprovalPrompt(application), () =>
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
              <EmptyState
                title="No restaurants yet"
                body="A restaurant is created when its partner application is approved, so this stays empty until the first approval goes through."
                note={queueFreshness}
              />
            ) : (
              restaurants.map((restaurant) => (
                <div key={restaurant.id} className="list-row">
                  <div>
                    <div className="list-row-title">{restaurant.name}</div>
                    <div className="list-row-sub">{restaurant.address ?? 'Address pending'}</div>
                    {/* Publish and Unpublish are judgements about whether this
                        restaurant should be in front of customers, and the
                        customers who have already eaten there have been
                        answering that question into a void -- the aggregate
                        moved on every order rated and no operator surface read
                        it. It belongs next to the button, not a query away. */}
                    <div className="restaurant-rating-line">
                      <RestaurantRating restaurant={restaurant} />
                    </div>
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
