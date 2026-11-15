import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { alertsAfterResolve, isAlertResolved } from '../lib/alertResolution';
import { formatDateTime, formatNumber, humanizeStatus } from '../lib/format';
import { describeWriteFailure } from '../lib/writeOutcome';
import { useDocumentVisibility } from '../lib/useDocumentVisibility';
import { resolveViewState } from '../lib/viewState';
import {
  getAdminOperationalAlerts,
  listAdminFeatureFlags,
  resolveAdminOperationalAlert,
  upsertAdminFeatureFlag,
  type FeatureFlagRecord,
  type OperationalAlertRecord,
} from '../services/platformReads';

const formatFlagLabel = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const getSeverityTone = (severity: OperationalAlertRecord['severity']) => {
  switch (severity) {
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
    default:
      return 'info';
  }
};

/**
 * How many alerts this page shows at once. There is no pagination, so this is
 * a cap and never a total -- see ALERT_PROBE_LIMIT.
 */
const ALERT_PAGE_SIZE = 50;

/**
 * One more than we display. The surplus row is fetched, counted and thrown
 * away: it exists only to answer "is there a 51st?", which is what lets the
 * header say "50+ alerts" instead of "50 alerts".
 *
 * Without it the page rendered `{alerts.length} alerts`, so a backlog of 51
 * and a backlog of 5,000 both printed "50" -- the number an operator uses to
 * decide whether anything is wrong was pinned to the size of the fetch. The
 * probe is safe to send: adminGetOperationalAlerts passes limit straight to
 * loadOperationalAlerts, which floors it at 1 and applies no upper clamp.
 */
const ALERT_PROBE_LIMIT = ALERT_PAGE_SIZE + 1;

// The page read once on mount, so a new alert never appeared without a manual
// Refresh. Same slow, visibility-gated rate as the rest of the console.
const POLL_INTERVAL_MS = 120000;

const hasMetadata = (metadata: Record<string, unknown> | null) => Boolean(metadata && Object.keys(metadata).length > 0);

const formatMetadata = (metadata: Record<string, unknown> | null) => {
  try {
    return JSON.stringify(metadata ?? {}, null, 2);
  } catch {
    return 'Unable to render metadata.';
  }
};

export default function ObservabilityPage() {
  const [alerts, setAlerts] = useState<OperationalAlertRecord[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlagRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a SUCCESSFUL read may license an empty state: `loading` settles to
  // false on the catch path too, so it cannot tell "nothing here" from
  // "we never got an answer".
  const [loaded, setLoaded] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [alertsTruncated, setAlertsTruncated] = useState(false);
  // Open alerts only by default; resolved ones are a history, not a queue.
  const [showResolved, setShowResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Shown in the detail panel beside Mark resolved, not in the page banner,
  // and kept apart from `error` so the next successful read cannot wipe it.
  const [resolveError, setResolveError] = useState<string | null>(null);
  const isVisible = useDocumentVisibility();
  // Bumped per read so a response that predates the latest Show-resolved toggle
  // (or a newer read) is dropped instead of overwriting the list.
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    requestRef.current += 1;
    const requestId = requestRef.current;
    setBusy(true);
    try {
      const [alertResponse, flagResponse] = await Promise.all([
        getAdminOperationalAlerts({ limit: ALERT_PROBE_LIMIT, offset: 0, includeResolved: showResolved }),
        listAdminFeatureFlags(),
      ]);

      if (requestId !== requestRef.current) {
        return;
      }

      const alertPage = alertResponse.operationalAlerts ?? [];
      setAlertsTruncated(alertPage.length > ALERT_PAGE_SIZE);
      setAlerts(alertPage.slice(0, ALERT_PAGE_SIZE));
      setFeatureFlags(flagResponse.featureFlags ?? []);
      setError(null);
      setLoaded(true);
    } catch (nextError) {
      if (requestId !== requestRef.current) {
        return;
      }

      setError(nextError instanceof Error ? nextError.message : 'Unable to load observability data.');
    } finally {
      if (requestId === requestRef.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }, [showResolved]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useVisiblePolling(() => void refresh(), POLL_INTERVAL_MS, isVisible);

  const onResolve = async (alertId: string) => {
    setResolvingId(alertId);
    setResolveError(null);
    try {
      const { alert } = await resolveAdminOperationalAlert(alertId);
      setAlerts((current) => alertsAfterResolve(current, alert, showResolved));
    } catch (nextError) {
      let reloaded = false;
      const message = await describeWriteFailure(nextError, {
        fallback: 'Unable to resolve this alert.',
        reload: async () => {
          reloaded = true;
          await refresh();
        },
      });
      if (!reloaded) {
        await refresh();
      }
      setResolveError(message);
    } finally {
      setResolvingId(null);
    }
  };

  useEffect(() => {
    if (selectedAlertId && alerts.some((alert) => alert.id === selectedAlertId)) {
      return;
    }

    setSelectedAlertId(alerts[0]?.id ?? null);
  }, [alerts, selectedAlertId]);

  const selectedAlert = useMemo(
    () => alerts.find((alert) => alert.id === selectedAlertId) ?? null,
    [alerts, selectedAlertId]
  );

  const selectedAlertMetadata = selectedAlert ? formatMetadata(selectedAlert.metadata) : null;
  const selectedAlertHasMetadata = selectedAlert ? hasMetadata(selectedAlert.metadata) : false;

  const onToggleFlag = async (flag: FeatureFlagRecord) => {
    setBusy(true);
    try {
      await upsertAdminFeatureFlag({
        description: flag.description,
        enabled: !flag.enabled,
        key: flag.key,
      });
      await refresh();
    } catch (nextError) {
      setError(await describeWriteFailure(nextError, { fallback: 'Unable to update feature flag.', reload: refresh }));
    } finally {
      setBusy(false);
    }
  };

  const sortedFlags = useMemo(
    () => [...featureFlags].sort((left, right) => left.key.localeCompare(right.key)),
    [featureFlags]
  );

  // Both panels resolve against `loaded`, never `loading`: `loading` settles
  // to false on the catch path as well, so it cannot separate a quiet platform
  // from an unreachable one.
  const alertsState = resolveViewState({ hasData: loaded, error, isEmpty: alerts.length === 0 });
  const flagsState = resolveViewState({ hasData: loaded, error, isEmpty: sortedFlags.length === 0 });

  // "50+" when the probe found a 51st row, plain "12" when it did not. The
  // suffix is the whole point: it is the only thing separating a count from a
  // cap on a page with no pagination.
  //
  // The dash before a read lands matters just as much. `alerts` starts empty
  // and stays empty when the fetch throws, so these badges previously read
  // "0 alerts" / "0 queued" on a page whose entire purpose is telling an
  // operator whether anything is wrong -- an unreachable alert queue rendered
  // as an all-clear, which is the worst answer this page could give.
  const alertCountLabel = loaded ? `${alerts.length}${alertsTruncated ? '+' : ''}` : '—';
  const alertCountNoun = showResolved ? 'alerts' : 'open';
  const alertCountTitle = !loaded
    ? 'The alert queue has not loaded, so no count can be shown.'
    : alertsTruncated
      ? `Showing the ${ALERT_PAGE_SIZE} most recent alerts; more exist beyond this page.`
      : `All ${alerts.length} alerts are shown.`;

  // Same reasoning for the flag chrome: "0 flags" and "0 enabled" are claims
  // about configuration, and a failed read is not evidence for either.
  const flagCountLabel = loaded ? formatNumber(featureFlags.length) : '—';
  const enabledFlagLabel = loaded ? formatNumber(sortedFlags.filter((flag) => flag.enabled).length) : '—';

  return (
    <section className="page observability-page">
      <div className="page-header">
        <div>
          <h2 className="card-title" style={{ marginBottom: 6 }}>
            Observability
          </h2>
          <div className="muted">Review-only alert queue and dark-launch feature flags for platform operators.</div>
        </div>
        <div className="filters-row">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Refreshing...' : 'Refresh'}
          </button>
          <span className="badge badge-neutral" title={alertCountTitle}>
            {alertCountLabel} {alertCountNoun}
          </span>
          <span className="badge badge-primary">{flagCountLabel} flags</span>
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {loading ? <LoadingBlock label="Loading observability..." /> : null}

      <div className="grid-2 observability-grid">
        <div className="card observability-alerts-card">
          <div className="card-title-row">
            <h3 className="card-title">Operational alerts</h3>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className={`btn btn-ghost btn-sm ${showResolved ? 'active' : ''}`}
                aria-pressed={showResolved}
                onClick={() => setShowResolved((value) => !value)}
              >
                {showResolved ? 'Hide resolved' : 'Show resolved'}
              </button>
              <span className="badge badge-warning" title={alertCountTitle}>
                {alertCountLabel} {showResolved ? 'shown' : 'open'}
              </span>
            </span>
          </div>

          {alertsTruncated ? (
            <div className="muted">
              Showing the {ALERT_PAGE_SIZE} most recent alerts. Older ones are not on this page.
            </div>
          ) : null}

          {alertsState === 'empty' ? (
            <EmptyState
              title={showResolved ? 'No alerts recorded' : 'No open alerts'}
              body={
                showResolved
                  ? 'Nothing has crossed a dispatch, payment or acceptance threshold. Alerts are raised automatically, so an empty queue is the healthy state rather than a switched-off one.'
                  : 'Nothing open has crossed a dispatch, payment or acceptance threshold. Resolved alerts are hidden; use Show resolved to see them. An alert that is raised again after being resolved comes back here.'
              }
            />
          ) : alertsState !== 'ready' ? null : (
            <div className="risk-signals-list">
              {alerts.map((alert) => {
                const isSelected = alert.id === selectedAlertId;

                return (
                  <button
                    key={alert.id}
                    type="button"
                    className={`risk-signals-item ${isSelected ? 'selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      // Cleared on the user's pick only: a reload that moves the
                      // selection must not wipe an error they have not read.
                      setResolveError(null);
                      setSelectedAlertId(alert.id);
                    }}
                  >
                    <div className="risk-signals-item-main">
                      <div className="risk-signals-item-head">
                        <div>
                          <div className="list-row-title">{formatFlagLabel(alert.alertType)}</div>
                          <div className="list-row-sub">
                            {humanizeStatus(alert.subjectType)} {alert.subjectId}
                          </div>
                        </div>
                        <span className="badge badge-neutral">{formatDateTime(alert.updatedAt)}</span>
                      </div>
                      <p className="risk-signals-reason">{alert.details}</p>
                    </div>
                    <div className="risk-signals-item-meta">
                      {isAlertResolved(alert) ? <span className="badge badge-neutral">Resolved</span> : null}
                      <StatusBadge label={alert.severity} tone={getSeverityTone(alert.severity)} />
                      <span className="badge badge-neutral">{formatFlagLabel(alert.title)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card observability-detail-card">
          {alertsState !== 'ready' ? null : !selectedAlert ? (
            // Gated on the queue being READY, not merely on `loaded`. The
            // original reasoning stands -- do not instruct an operator to pick
            // from a queue we failed to fetch -- but `loaded` was true for an
            // empty queue too, so a cleared alert list still drew "choose an
            // alert from the queue" next to a panel saying there were none.
            <EmptyState
              title="Select an alert"
              body="Choose an alert from the queue to inspect its metadata and trace the triggering subject."
            />
          ) : (
            <div className="section-stack">
              <div className="card-title-row">
                <h3 className="card-title">{formatFlagLabel(selectedAlert.alertType)}</h3>
                <StatusBadge label={selectedAlert.severity} tone={getSeverityTone(selectedAlert.severity)} />
              </div>

              <div className="risk-signals-summary">
                <div className="muted">
                  {humanizeStatus(selectedAlert.subjectType)} {selectedAlert.subjectId}
                </div>
                <div className="badge badge-neutral">{formatDateTime(selectedAlert.updatedAt)}</div>
              </div>

              {/* Resolving says "a human has dealt with this". If the same
                  condition is raised again the alert re-opens on its own. */}
              {isAlertResolved(selectedAlert) ? (
                <div className="muted">Resolved {formatDateTime(selectedAlert.resolvedAt as string)}.</div>
              ) : (
                <div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={resolvingId !== null}
                    onClick={() => void onResolve(selectedAlert.id)}
                  >
                    {resolvingId === selectedAlert.id ? 'Resolving…' : 'Mark resolved'}
                  </button>
                </div>
              )}
              {resolveError ? <ErrorBanner message={resolveError} /> : null}

              <div className="risk-signals-detail-grid">
                <div>
                  <div className="detail-label">Title</div>
                  <div>{selectedAlert.title}</div>
                </div>
                <div>
                  <div className="detail-label">Deduped by</div>
                  <div className="code-line">{selectedAlert.dedupeKey}</div>
                </div>
              </div>

              <div>
                <div className="detail-label">Metadata</div>
                {selectedAlertHasMetadata ? (
                  <pre className="risk-signals-json">{selectedAlertMetadata}</pre>
                ) : (
                  <EmptyState title="No metadata recorded" body="This alert did not capture any structured metadata." />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card observability-flags-card" style={{ marginTop: 20 }}>
        <div className="card-title-row">
          <div>
            <h3 className="card-title">Feature flags</h3>
            <div className="muted">Flags default closed until explicitly enabled by an admin.</div>
          </div>
          <span className="badge badge-primary">{enabledFlagLabel} enabled</span>
        </div>

        {flagsState === 'empty' ? (
          <EmptyState
            title="No feature flags yet"
            body="Nothing is gated behind a switch, so every feature is running as it was built. Add a flag to dark-launch risky work without a redeploy."
          />
        ) : flagsState !== 'ready' ? null : (
          <div className="feature-flag-list">
            {sortedFlags.map((flag) => (
              <div key={flag.key} className="feature-flag-row">
                <div className="feature-flag-row-main">
                  <div className="feature-flag-row-head">
                    <div className="list-row-title">{formatFlagLabel(flag.key)}</div>
                    <StatusBadge label={flag.enabled ? 'Enabled' : 'Disabled'} tone={flag.enabled ? 'success' : 'neutral'} />
                  </div>
                  <div className="muted">{flag.description || 'No description provided.'}</div>
                </div>
                <div className="feature-flag-row-side">
                  <span className="badge badge-neutral">Updated {formatDateTime(flag.updatedAt)}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void onToggleFlag(flag)}
                  >
                    {flag.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
