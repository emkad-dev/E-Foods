import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import { humanizeStatus } from '../lib/format';
import { resolveViewState } from '../lib/viewState';
import {
  AUDIT_TIME_NOTE,
  EMPTY_AUDIT_VOCABULARY,
  auditOptionLabel,
  describeAuditActor,
  flattenAuditDetails,
  formatAuditTimestamp,
  mergeAuditVocabulary,
  type AuditLogEntry,
  type AuditVocabulary,
} from '../lib/auditLog';
import { getAdminAuditLog } from '../services/platformReads';

/**
 * THE ADMIN AUDIT TRAIL.
 *
 * Every privileged mutation in this console has written a row to
 * AdminAuditLog since the console was built -- partner and dispatch approvals,
 * rejections, role grants and revocations, access disable/enable, restaurant
 * publish and unpublish, staff provisioning, promo changes. Until this page
 * nothing could read any of them: "who approved this restaurant" was a
 * question with a recorded answer and no way to ask it short of opening the
 * database. A record nobody can consult is not an audit trail.
 *
 * WHY ITS OWN PAGE RATHER THAN A PANEL ON OBSERVABILITY. Three reasons, and
 * the third is the one that settles it.
 *
 *  1. Different question. Observability answers "is something wrong RIGHT
 *     NOW" -- an alert queue and dark-launch flags, both live state. This
 *     answers "what did we do, and who did it", which is history. They are
 *     read at different times for different reasons.
 *  2. Different shape. This needs four filters, a pager and a variable-height
 *     details block per row. Observability is already three cards in a
 *     two-column grid; a fourth card carrying all of that would bury the log
 *     at the bottom of a page nobody scrolls, and it would be the only
 *     paginated thing on a page with no pagination anywhere else.
 *  3. Observability OWNS A WRITE. Its feature-flag rows toggle. This view must
 *     be unambiguously read-only -- the table is service-role-only precisely so
 *     that an admin client cannot edit its own history -- and putting a
 *     history nobody may touch on the same page as the console's flag switches
 *     makes that boundary a matter of noticing which card you are in.
 *
 * So: its own route, its own nav entry, directly after Observability.
 *
 * THERE IS NO CONTROL ON THIS PAGE THAT WRITES. Nothing here edits, redacts or
 * deletes an entry, and nothing should ever be added that does. The buttons
 * are filters, a pager and a refresh.
 */

/** Matches the server default. The server clamps anything above 100. */
const PAGE_SIZE = 50;

type AuditFilters = {
  action: string;
  actorUid: string;
  targetId: string;
  targetType: string;
};

const NO_FILTERS: AuditFilters = { action: '', actorUid: '', targetId: '', targetType: '' };

const hasAnyFilter = (filters: AuditFilters) => Object.values(filters).some((value) => value !== '');

/** Empty string means "no filter"; the RPC wants the key absent, not blank. */
const toRequest = (filters: AuditFilters, offset: number) => ({
  limit: PAGE_SIZE,
  offset,
  ...(filters.action ? { action: filters.action } : {}),
  ...(filters.actorUid ? { actorUid: filters.actorUid } : {}),
  ...(filters.targetId ? { targetId: filters.targetId } : {}),
  ...(filters.targetType ? { targetType: filters.targetType } : {}),
});

function AuditDetails({ entry }: { entry: AuditLogEntry }) {
  const fields = useMemo(() => flattenAuditDetails(entry.details), [entry.details]);

  // The verbatim record, kept as a collapsed second opinion. The field list
  // above is the primary display because a wall of JSON is not readable, but
  // the flattener is code and code can be wrong -- so the bytes the server
  // actually sent stay one click away rather than being replaced by this
  // page's interpretation of them.
  const raw = useMemo(() => {
    try {
      return JSON.stringify(entry.details, null, 2);
    } catch {
      return null;
    }
  }, [entry.details]);

  if (fields.length === 0) {
    return <div className="audit-detail-empty">No details were recorded for this action.</div>;
  }

  return (
    <>
      <dl className="audit-detail-grid">
        {fields.map((field) => (
          <div key={field.path} className="audit-detail-field">
            <dt className="audit-detail-path">{field.path}</dt>
            <dd className="audit-detail-value">{field.value}</dd>
          </div>
        ))}
      </dl>
      {raw ? (
        <details className="audit-raw">
          <summary className="audit-raw-summary">Recorded JSON</summary>
          <pre className="risk-signals-json">{raw}</pre>
        </details>
      ) : null}
    </>
  );
}

export default function AuditLogPage() {
  const [filters, setFilters] = useState<AuditFilters>(NO_FILTERS);
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a SUCCESSFUL read licenses an empty state. This is the same rule the
  // rest of the console follows (lib/viewState.ts): "no entries" is a claim
  // about the platform's history and a failed fetch is not evidence for it.
  const [loaded, setLoaded] = useState(false);

  // Filter options observed across every response this session, never shrunk.
  // See lib/auditLog.ts for why a per-response derivation strands the operator.
  const [vocabulary, setVocabulary] = useState<AuditVocabulary>(EMPTY_AUDIT_VOCABULARY);

  // The target-id box is typed into, so it is applied on submit rather than on
  // every keystroke -- an audit read per character is a lot of edge-function
  // invocations for a field that is usually pasted.
  const [targetIdDraft, setTargetIdDraft] = useState('');

  // Paging and filtering both fire fetches, and a slow earlier one must not
  // repaint the page with a result the operator has already moved past.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy(true);

    try {
      const response = await getAdminAuditLog(toRequest(filters, offset));

      if (requestRef.current !== requestId) {
        return;
      }

      const page = response.entries ?? [];
      setEntries(page);
      setHasMore(response.hasMore === true);
      setVocabulary((previous) => mergeAuditVocabulary(previous, page));
      setError(null);
      setLoaded(true);
    } catch (nextError) {
      if (requestRef.current !== requestId) {
        return;
      }
      setError(nextError instanceof Error ? nextError.message : 'Unable to load the audit log.');
    } finally {
      if (requestRef.current === requestId) {
        setBusy(false);
      }
    }
  }, [filters, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter change is a new query, so it starts at the first page. Leaving
  // the offset put is how an operator filters and lands on an empty page that
  // looks like "no matches".
  const applyFilter = (patch: Partial<AuditFilters>) => {
    setOffset(0);
    setFilters((previous) => ({ ...previous, ...patch }));
  };

  const clearFilters = () => {
    setOffset(0);
    setTargetIdDraft('');
    setFilters(NO_FILTERS);
  };

  const filtered = hasAnyFilter(filters);
  const viewState = resolveViewState({ hasData: loaded, error, isEmpty: entries.length === 0 });

  const rangeLabel = loaded
    ? entries.length === 0
      ? 'No entries on this page'
      : `Entries ${offset + 1}–${offset + entries.length}`
    : '—';

  return (
    <section className="page audit-page">
      <div className="page-header">
        <div>
          <h2 className="card-title" style={{ marginBottom: 6 }}>
            Audit log
          </h2>
          <div className="muted">
            Every privileged action this console has taken, newest first. Read-only: this history cannot be edited or
            deleted from here.
          </div>
        </div>
        <div className="filters-row">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
            {busy ? 'Loading...' : 'Refresh'}
          </button>
          <span className="badge badge-neutral">{rangeLabel}</span>
        </div>
      </div>

      {/* The timezone statement. It belongs above the log rather than in a
          tooltip on each row: it is a property of the column, and an operator
          reading a time needs to know what clock it is on before they read it,
          not after they wonder. */}
      <div className="audit-note">{AUDIT_TIME_NOTE}</div>

      <div className="card">
        <div className="filters-row audit-filters">
          <label className="audit-filter">
            <span className="detail-label">Action</span>
            <select
              className="select-pill audit-select"
              value={filters.action}
              onChange={(event) => applyFilter({ action: event.target.value })}
            >
              <option value="">All actions</option>
              {vocabulary.actions.map((action) => (
                <option key={action} value={action}>
                  {auditOptionLabel(action)}
                </option>
              ))}
            </select>
          </label>

          <label className="audit-filter">
            <span className="detail-label">Target type</span>
            <select
              className="select-pill audit-select"
              value={filters.targetType}
              onChange={(event) => applyFilter({ targetType: event.target.value })}
            >
              <option value="">All target types</option>
              {vocabulary.targetTypes.map((targetType) => (
                <option key={targetType} value={targetType}>
                  {auditOptionLabel(targetType)}
                </option>
              ))}
            </select>
          </label>

          <label className="audit-filter">
            <span className="detail-label">Actor</span>
            <select
              className="select-pill audit-select"
              value={filters.actorUid}
              onChange={(event) => applyFilter({ actorUid: event.target.value })}
            >
              <option value="">All actors</option>
              {vocabulary.actors.map((actor) => (
                <option key={actor.uid} value={actor.uid}>
                  {actor.label}
                </option>
              ))}
            </select>
          </label>

          <form
            className="audit-filter"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilter({ targetId: targetIdDraft.trim() });
            }}
          >
            <span className="detail-label">Target id</span>
            <div className="audit-filter-inline">
              <input
                className="audit-input"
                placeholder="Paste an id"
                value={targetIdDraft}
                onChange={(event) => setTargetIdDraft(event.target.value)}
              />
              <button type="submit" className="btn btn-ghost btn-sm audit-control">
                Find
              </button>
            </div>
          </form>

          {filtered ? (
            <button type="button" className="btn btn-ghost btn-sm audit-control" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>

        {/* The options are DERIVED from rows that have arrived, so they are a
            list of what has been seen -- not an enumeration of what exists.
            Saying so is the price of never going stale. */}
        <div className="muted audit-filter-note">
          Filter options are built from entries loaded so far, so an action that has not appeared yet will not be listed.
          Paging through more history adds to them.
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {viewState === 'loading' ? <SkeletonRows count={6} /> : null}

      {viewState === 'empty' ? (
        <div className="card">
          <EmptyState
            title={filtered ? 'No entries match these filters' : offset > 0 ? 'No entries on this page' : 'No audit entries yet'}
            body={
              filtered
                ? 'Widen or clear the filters to see more of the history.'
                : offset > 0
                  ? 'You have paged past the end of the log. Go back to newer entries.'
                  : 'Privileged actions are recorded here as they happen — approvals, role changes, publishing and access changes.'
            }
          />
        </div>
      ) : null}

      {viewState === 'ready' ? (
        <div className="card audit-list">
          {entries.map((entry) => {
            const actor = describeAuditActor(entry);
            const timestamp = formatAuditTimestamp(entry.createdAt);

            return (
              <article key={entry.id} className="audit-entry">
                <div className="audit-entry-head">
                  <div className="audit-entry-identity">
                    <span className="badge badge-primary">{humanizeStatus(entry.action)}</span>
                    <span className="audit-entry-target">
                      {humanizeStatus(entry.targetType)}
                      {entry.targetId ? (
                        <button
                          type="button"
                          className="audit-target-id"
                          // The motivating question -- "who approved this
                          // restaurant" -- is a targetId query, so the id is
                          // the control that asks it rather than something to
                          // copy out and paste back into the box above.
                          title={`Show every entry for ${entry.targetId}`}
                          onClick={() => {
                            setTargetIdDraft(entry.targetId ?? '');
                            applyFilter({ targetId: entry.targetId ?? '' });
                          }}
                        >
                          {entry.targetId}
                        </button>
                      ) : (
                        <span className="audit-entry-no-target">no target id recorded</span>
                      )}
                    </span>
                  </div>
                  <div className="audit-entry-when">
                    {/* The raw stored string is always one hover away, so the
                        reformatting above can never be the only version of the
                        record the operator can reach. */}
                    <span title={String(entry.createdAt)}>{timestamp.label}</span>
                    {timestamp.carriesOffset ? (
                      <span className="badge badge-warning" title={String(entry.createdAt)}>
                        offset not applied
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="audit-entry-actor">
                  <span className="audit-actor-name">{actor.primary}</span>
                  {actor.secondary ? <span className="audit-actor-meta">{actor.secondary}</span> : null}
                  {actor.unresolved ? <span className="badge badge-neutral">unresolved uid</span> : null}
                </div>

                <AuditDetails entry={entry} />
              </article>
            );
          })}
        </div>
      ) : null}

      {loaded ? (
        <div className="card audit-pager">
          <button
            type="button"
            className="btn btn-ghost btn-sm audit-control"
            disabled={busy || offset === 0}
            onClick={() => setOffset((previous) => Math.max(previous - PAGE_SIZE, 0))}
          >
            ← Newer
          </button>
          <span className="muted">{rangeLabel}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm audit-control"
            // `hasMore` is the server's "this page came back full" hint, not a
            // count, so this can be enabled onto an empty page. That is why the
            // empty state above has a sentence for exactly that case rather
            // than reporting it as "no entries".
            disabled={busy || !hasMore}
            onClick={() => setOffset((previous) => previous + PAGE_SIZE)}
          >
            Older →
          </button>
        </div>
      ) : null}
    </section>
  );
}
