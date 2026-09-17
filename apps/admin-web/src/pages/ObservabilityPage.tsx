import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime, humanizeStatus } from '../lib/format';
import {
  getAdminOperationalAlerts,
  listAdminFeatureFlags,
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

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [alertResponse, flagResponse] = await Promise.all([
        getAdminOperationalAlerts({ limit: 50, offset: 0 }),
        listAdminFeatureFlags(),
      ]);

      setAlerts(alertResponse.operationalAlerts ?? []);
      setFeatureFlags(flagResponse.featureFlags ?? []);
      setError(null);
      setLoaded(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load observability data.');
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      setError(nextError instanceof Error ? nextError.message : 'Unable to update feature flag.');
    } finally {
      setBusy(false);
    }
  };

  const sortedFlags = useMemo(
    () => [...featureFlags].sort((left, right) => left.key.localeCompare(right.key)),
    [featureFlags]
  );

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
          <span className="badge badge-neutral">{alerts.length} alerts</span>
          <span className="badge badge-primary">{featureFlags.length} flags</span>
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {loading ? <LoadingBlock label="Loading observability..." /> : null}

      <div className="grid-2 observability-grid">
        <div className="card observability-alerts-card">
          <div className="card-title-row">
            <h3 className="card-title">Operational alerts</h3>
            <span className="badge badge-warning">{alerts.length} queued</span>
          </div>

          {loaded && alerts.length === 0 ? (
            <EmptyState
              title="No alerts yet"
              body="Alerts will appear here when dispatch, payment, or acceptance flows cross their threshold."
            />
          ) : (
            <div className="risk-signals-list">
              {alerts.map((alert) => {
                const isSelected = alert.id === selectedAlertId;

                return (
                  <button
                    key={alert.id}
                    type="button"
                    className={`risk-signals-item ${isSelected ? 'selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedAlertId(alert.id)}
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
          {!selectedAlert ? (
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
          <span className="badge badge-primary">{sortedFlags.filter((flag) => flag.enabled).length} enabled</span>
        </div>

        {loaded && sortedFlags.length === 0 ? (
          <EmptyState title="No feature flags yet" body="Add a flag to dark-launch risky work behind a server-controlled switch." />
        ) : (
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
