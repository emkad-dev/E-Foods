import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    try {
      const res = await listBroadcasts();
      setBroadcasts(res.broadcasts);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load broadcasts.');
    } finally {
      setLoading(false);
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

  const channels = [...(emailChannel ? ['email'] : []), ...(pushChannel ? ['push'] : [])];

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

  const onSendNow = async () => {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await scheduleBroadcast(selected.id);
      setSelected(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Send failed.');
    } finally {
      setBusy(false);
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
        {error ? <ErrorBanner message={error} /> : null}
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
            disabled={busy || !title.trim()}
            onClick={() => void onCreate()}
          >
            Create draft
          </button>
        </div>
        {selected ? (
          <div className="broadcast-send">
            <p className="muted">Draft “{selected.title}” created. Send it:</p>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSendNow()}>
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
        {loading ? <LoadingBlock label="Loading…" /> : null}
        {!loading && broadcasts.length === 0 ? (
          <EmptyState title="No broadcasts yet" body="Compose one on the left." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
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
                    <td>{broadcast.recipientCount}</td>
                    <td>
                      {broadcast.sentEmail + broadcast.sentPush}
                      {broadcast.failedEmail + broadcast.failedPush > 0
                        ? ` (${broadcast.failedEmail + broadcast.failedPush} failed)`
                        : ''}
                    </td>
                    <td>
                      {broadcast.scheduledAt
                        ? new Date(broadcast.scheduledAt).toLocaleString()
                        : new Date(broadcast.createdAt).toLocaleString()}
                    </td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
