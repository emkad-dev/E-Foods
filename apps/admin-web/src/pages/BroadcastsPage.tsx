import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { resolveViewState } from '../lib/viewState';
import {
  broadcastTone,
  cancelBroadcast,
  createBroadcast,
  listBroadcasts,
  previewAudience,
  scheduleBroadcast,
  type Broadcast,
  type BroadcastSegment,
} from '../services/broadcasts';

type ActivityChoice = 'none' | 'active30' | 'lapsed60';

const activityToSegment = (choice: ActivityChoice): BroadcastSegment['activity'] => {
  if (choice === 'active30') {
    return { orderedWithinDays: 30 };
  }
  if (choice === 'lapsed60') {
    return { notOrderedForDays: 60 };
  }
  return null;
};

const SEGMENT_ROLES = ['customer', 'restaurant', 'dispatch'] as const;

export default function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Only a SUCCESSFUL read may license an empty state. There is deliberately
  // no separate `loading` flag any more: it settled to false on the catch
  // path too, so it could never distinguish "nothing here" from "we never got
  // an answer", and resolveViewState derives the spinner from this plus the
  // error instead.
  const [loaded, setLoaded] = useState(false);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'marketing' | 'transactional'>('marketing');
  const [emailChannel, setEmailChannel] = useState(true);
  const [pushChannel, setPushChannel] = useState(false);
  const [roles, setRoles] = useState<string[]>(['customer']);
  const [activity, setActivity] = useState<ActivityChoice>('none');
  const [restaurantId, setRestaurantId] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Broadcast | null>(null);
  const [schedAt, setSchedAt] = useState('');
  const [busy, setBusy] = useState(false);
  // Send now is the one control on this screen that cannot be taken back --
  // broadcastSchedule with no timestamp stamps `now`, so the runner can pick
  // the broadcast up before the operator has let go of the mouse. Schedule
  // and Cancel both stay unconfirmed on purpose: the server lets a scheduled,
  // canceled or failed broadcast be scheduled again, so neither of those is
  // a one-way door.
  const [sendConfirm, setSendConfirm] = useState<Broadcast | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listBroadcasts();
      setBroadcasts(res.broadcasts);
      setError(null);
      setLoaded(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load broadcasts.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buildSegment = (): BroadcastSegment => ({
    roles,
    activity: activityToSegment(activity),
    restaurantId: restaurantId.trim() || null,
  });

  // A recipient count belongs to the segment it was measured for. Nothing used
  // to clear it, so an operator could preview "50 recipients", then tick two
  // more roles, and send to an audience of thousands with a stale 50 still on
  // screen beside the Create draft button vouching for it. Any input that
  // feeds buildSegment()/previewAudience invalidates the number; re-press
  // Preview recipients to get one that matches.
  useEffect(() => {
    setPreviewCount(null);
  }, [roles, activity, restaurantId, category]);

  const channels = [...(emailChannel ? ['email'] : []), ...(pushChannel ? ['push'] : [])];

  const listState = resolveViewState({
    hasData: loaded,
    error,
    isEmpty: broadcasts.length === 0,
  });

  // Create draft used to be enabled on a non-empty title alone, so a draft
  // with zero channels, no subject and no body was one click away on a screen
  // that sends real email. Every channel that is ticked must carry the content
  // it will actually send.
  const emailReady = !emailChannel || (emailSubject.trim().length > 0 && emailBody.trim().length > 0);
  const pushReady = !pushChannel || (pushTitle.trim().length > 0 && pushBody.trim().length > 0);
  const canCreate = title.trim().length > 0 && channels.length > 0 && emailReady && pushReady;
  const createBlockedReason = !title.trim()
    ? 'Give the broadcast a title.'
    : channels.length === 0
      ? 'Pick at least one channel.'
      : !emailReady
        ? 'Email is ticked: fill in the subject and body.'
        : !pushReady
          ? 'Push is ticked: fill in the push title and body.'
          : undefined;

  const toggleRole = (role: string) =>
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  const onPreview = async () => {
    setBusy(true);
    try {
      const res = await previewAudience(buildSegment(), category);
      setPreviewCount(res.recipientCount);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  };

  const onCreate = async () => {
    setBusy(true);
    try {
      const { broadcast } = await createBroadcast({
        title,
        category,
        channels,
        segment: buildSegment(),
        emailSubject,
        emailBody,
        pushTitle,
        pushBody,
      });
      setSelected(broadcast);
      setError(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  const onSendNow = async (broadcast: Broadcast) => {
    setBusy(true);
    try {
      await scheduleBroadcast(broadcast.id);
      setSelected(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Send failed.');
    } finally {
      setBusy(false);
      setSendConfirm(null);
    }
  };

  const onSchedule = async () => {
    if (!selected || !schedAt) {
      return;
    }
    setBusy(true);
    try {
      await scheduleBroadcast(selected.id, new Date(schedAt).toISOString());
      setSelected(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Schedule failed.');
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async (broadcast: Broadcast) => {
    setBusy(true);
    try {
      await cancelBroadcast(broadcast.id);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page broadcasts-page">
      <div className="broadcast-compose card">
        <h3>New broadcast</h3>
        {/* This page reads once on mount and never polls, so without a retry
            a failed first load left the list permanently blank with a full
            browser reload as the only way out. */}
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        <div className="field">
          <label htmlFor="bc-title">Title</label>
          <input id="bc-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bc-category">Category</label>
          <select
            id="bc-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as 'marketing' | 'transactional')}
          >
            <option value="marketing">Marketing (customers, unsubscribe)</option>
            <option value="transactional">Transactional / operational (no opt-out)</option>
          </select>
        </div>
        <div className="field">
          <label>Channels</label>
          <div className="check-row">
            <label>
              <input
                type="checkbox"
                checked={emailChannel}
                onChange={(event) => setEmailChannel(event.target.checked)}
              />{' '}
              Email
            </label>
            <label>
              <input
                type="checkbox"
                checked={pushChannel}
                onChange={(event) => setPushChannel(event.target.checked)}
              />{' '}
              Push
            </label>
          </div>
        </div>
        <div className="field">
          <label>Audience roles</label>
          <div className="check-row">
            {SEGMENT_ROLES.map((role) => (
              <label key={role}>
                <input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} /> {role}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="bc-activity">Customer activity</label>
          <select
            id="bc-activity"
            value={activity}
            onChange={(event) => setActivity(event.target.value as ActivityChoice)}
          >
            <option value="none">Any</option>
            <option value="active30">Ordered within 30 days</option>
            <option value="lapsed60">Not ordered for 60 days</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="bc-restaurant">Restaurant id (optional)</label>
          <input
            id="bc-restaurant"
            value={restaurantId}
            onChange={(event) => setRestaurantId(event.target.value)}
            placeholder="Only customers of this restaurant"
          />
        </div>
        {emailChannel ? (
          <>
            <div className="field">
              <label htmlFor="bc-subject">Email subject</label>
              <input id="bc-subject" value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="bc-body">Email body (HTML allowed)</label>
              <textarea
                id="bc-body"
                rows={5}
                value={emailBody}
                onChange={(event) => setEmailBody(event.target.value)}
              />
            </div>
          </>
        ) : null}
        {pushChannel ? (
          <>
            <div className="field">
              <label htmlFor="bc-push-title">Push title</label>
              <input id="bc-push-title" value={pushTitle} onChange={(event) => setPushTitle(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="bc-push-body">Push body</label>
              <textarea
                id="bc-push-body"
                rows={2}
                value={pushBody}
                onChange={(event) => setPushBody(event.target.value)}
              />
            </div>
          </>
        ) : null}
        <div className="broadcast-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onPreview()}>
            Preview recipients
          </button>
          {previewCount !== null ? <span className="badge badge-primary">{previewCount} recipients</span> : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !canCreate}
            title={createBlockedReason}
            onClick={() => void onCreate()}
          >
            Create draft
          </button>
          {createBlockedReason ? <span className="muted">{createBlockedReason}</span> : null}
        </div>
        {selected ? (
          <div className="broadcast-send">
            <p className="muted">Draft “{selected.title}” selected. Send it:</p>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setSendConfirm(selected)}>
              Send now
            </button>
            <input type="datetime-local" value={schedAt} onChange={(event) => setSchedAt(event.target.value)} />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !schedAt}
              onClick={() => void onSchedule()}
            >
              Schedule
            </button>
          </div>
        ) : null}
      </div>

      <div className="broadcast-list card">
        <h3>Broadcasts</h3>
        {/* Same stacked-loading defect AccessPage had: the skeleton rendered
            above the table rather than instead of it, so a first load drew
            shimmer bars on top of a complete header row with an empty body
            under it. `loaded` kept the empty state honest, but the last
            branch was still the table, so a failed load simply said "no
            broadcasts" in header rows instead of in words. */}
        {listState === 'loading' ? <SkeletonRows count={5} /> : null}
        {listState === 'empty' ? (
          <EmptyState
            title="No broadcasts yet"
            body="Nothing has been sent or scheduled, so no customer has received one. Compose on the left; a broadcast appears here with its status as soon as it is queued."
          />
        ) : null}
        {listState === 'ready' ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  {/* Every row already carried its channels and category and
                      the table showed neither, so two broadcasts with the
                      same title and status were indistinguishable -- and
                      nothing on screen said whether a send had honoured
                      marketing opt-out or ignored it as transactional. */}
                  <th>Sent as</th>
                  <th>Recipients</th>
                  <th>Sent</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {broadcasts.map((broadcast) => (
                  <tr key={broadcast.id}>
                    <td className="cell-strong">{broadcast.title}</td>
                    <td>
                      <StatusBadge label={broadcast.status} tone={broadcastTone(broadcast.status)} />
                    </td>
                    <td>
                      <div>{broadcast.channels.length > 0 ? broadcast.channels.join(' + ') : 'no channel'}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {broadcast.category}
                      </div>
                    </td>
                    <td>{broadcast.recipientCount}</td>
                    <td>
                      {broadcast.sentEmail + broadcast.sentPush}
                      {broadcast.failedEmail + broadcast.failedPush > 0
                        ? ` (${broadcast.failedEmail + broadcast.failedPush} failed)`
                        : ''}
                    </td>
                    {/* sentAt outranks the other two and was never read, so a
                        broadcast that went out late showed the time it was
                        *meant* to go -- under a column headed "When" and a
                        status reading "sent". */}
                    <td>
                      {new Date(broadcast.sentAt ?? broadcast.scheduledAt ?? broadcast.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <div className="row-actions">
                        {/* Send now / Schedule used to exist only for the draft
                            this session had just created, because `selected`
                            was set nowhere but onCreate. One reload and a
                            draft was stranded: the table's only control was
                            Cancel, and only for `scheduled`, so a created-but-
                            unsent broadcast had no route to being sent or
                            removed. Selecting it here reopens the same send
                            panel the compose card shows after a create. */}
                        {broadcast.status === 'draft' ? (
                          <button
                            type="button"
                            className={`btn btn-sm ${selected?.id === broadcast.id ? 'btn-primary' : 'btn-ghost'}`}
                            disabled={busy}
                            aria-pressed={selected?.id === broadcast.id}
                            onClick={() => {
                              // Clear any time typed for a previously selected
                              // draft, so Schedule cannot fire this one at a
                              // timestamp chosen for a different broadcast.
                              setSchedAt('');
                              setSelected(broadcast);
                            }}
                          >
                            {selected?.id === broadcast.id ? 'Selected' : 'Send / schedule'}
                          </button>
                        ) : null}
                        {broadcast.status === 'scheduled' ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => void onCancel(broadcast)}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {sendConfirm ? (
        <ConfirmDialog
          title="Send this broadcast now?"
          body={
            <>
              <p>
                <strong>{sendConfirm.title}</strong> goes out immediately over{' '}
                {sendConfirm.channels.length > 0 ? sendConfirm.channels.join(' and ') : 'no channel'}, as a{' '}
                {sendConfirm.category} send.
              </p>
              <p>
                {sendConfirm.category === 'marketing'
                  ? 'Marketing sends skip anyone who has unsubscribed.'
                  : 'Transactional sends have no opt-out: every matching recipient is contacted.'}
              </p>
              <p>
                This cannot be recalled. Once the runner picks it up the mail is with the provider. Use Schedule
                instead if you want a window in which to change your mind.
              </p>
            </>
          }
          busy={busy}
          busyLabel="Sending…"
          cancelLabel="Cancel"
          confirmLabel="Send now"
          onCancel={() => setSendConfirm(null)}
          onConfirm={() => void onSendNow(sendConfirm)}
        />
      ) : null}
    </section>
  );
}
