import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime } from '../lib/format';
import { countNewSince, isNewSince, useLastVisit } from '../lib/lastVisit';
import { useSupportRealtime } from '../lib/useSupportRealtime';
import { resolveViewState } from '../lib/viewState';
import {
  assignConversation,
  getConversation,
  getInbox,
  getSupportTone,
  sendAgentReply,
  setStatus,
  type InboxConversation,
  type SupportMessage,
  type SupportStatus,
} from '../services/supportInbox';

const STATUS_FILTERS: Array<SupportStatus | 'all'> = ['open', 'pending', 'closed', 'all'];

/**
 * "Updated", not "New": `lastMessageAt` moves whenever anyone writes, so a
 * marked row may be a week-old conversation that a customer just replied to
 * -- which is exactly the row an agent most needs to find, and exactly the
 * one "New" would have mislabelled.
 *
 * The word carries the signal; the colour only reinforces it, and the hidden
 * tail says what the word is relative to. No animation: this list re-renders
 * on every realtime event, so anything that moved would keep moving.
 */
const UpdatedSinceMarker = () => (
  <span className="badge badge-info ml-2">
    Updated
    <span className="sr-only"> since your last visit</span>
  </span>
);

/**
 * What an empty list MEANS depends entirely on the filter above it, and the
 * one sentence it used to show ("No conversations") was wrong under three of
 * the four. An agent looking at a filtered list and reading an unqualified
 * "no conversations" concludes the inbox is empty; it may be full of closed
 * ones.
 */
const emptyInboxCopy = (statusFilter: SupportStatus | 'all'): { title: string; body: string } => {
  if (statusFilter === 'open') {
    return {
      title: "You're caught up",
      body: 'Nothing is open. A new customer message opens a conversation here automatically, so this is the cleared state rather than a filtered-out one.',
    };
  }

  if (statusFilter === 'all') {
    return {
      title: 'No conversations yet',
      body: 'No customer has written in. This view has no filter applied, so nothing is being hidden.',
    };
  }

  return {
    title: `Nothing is ${statusFilter}`,
    body: `No conversation currently has the ${statusFilter} status. Other conversations may exist under a different one — switch the filter above to see them.`,
  };
};

export default function InboxPage() {
  const [statusFilter, setStatusFilter] = useState<SupportStatus | 'all'>('open');
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The thread keeps its own error rather than sharing the list's. They fail
  // independently and both are cleared by their own next success, so pooling
  // them let a successful thread read wipe a banner that was still telling
  // the truth about a stale conversation list.
  const [threadError, setThreadError] = useState<string | null>(null);
  // Only a SUCCESSFUL read may license an empty state. There is deliberately
  // no separate `loading` flag any more: it settled to false on the catch
  // path too, so it could never distinguish "nothing here" from "we never got
  // an answer", and resolveViewState derives the spinner from this plus the
  // error instead.
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);

  /**
   * The instant this agent last LEFT the inbox, read once on mount, so the
   * rows that have moved since can be marked instead of re-read. Null on a
   * first visit and wherever storage is unavailable; both mark nothing, on
   * purpose — see lib/lastVisit.ts.
   */
  const previousVisit = useLastVisit('inbox');

  /**
   * When the list below last actually arrived. Set only on the success path,
   * next to `setLoaded`, so a failed refresh cannot advance it and make a
   * stale list look current.
   */
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const loadInbox = useCallback(async () => {
    try {
      const res = await getInbox({
        status: statusFilter === 'all' ? undefined : statusFilter,
        scope: 'all',
      });
      setConversations(res.conversations);
      setError(null);
      setLoaded(true);
      setLoadedAt(Date.now());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load the inbox.');
    }
  }, [statusFilter]);

  // The only fetch on this page that was still a bare await. A refused or
  // failed thread read threw as an unhandled rejection and left `messages`
  // holding the PREVIOUS conversation -- so the header named one customer
  // while the bubbles under it belonged to another, with nothing on screen
  // admitting the read had failed. Emptying the thread is the honest
  // outcome: better a blank thread and a banner than someone else's words.
  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await getConversation(id);
      setMessages(res.messages);
      setThreadError(null);
    } catch (nextError) {
      setMessages([]);
      setThreadError(nextError instanceof Error ? nextError.message : 'Unable to load this conversation.');
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    // Clear first, then fetch. Without this the new conversation's header
    // renders over the old one's messages for as long as the read takes --
    // the same misattribution as above, just briefer.
    setMessages([]);
    setThreadError(null);

    if (selectedId) {
      void loadThread(selectedId);
    }
  }, [selectedId, loadThread]);

  useSupportRealtime(
    useCallback(() => {
      void loadInbox();
      if (selectedId) {
        void loadThread(selectedId);
      }
    }, [loadInbox, loadThread, selectedId])
  );

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const listState = resolveViewState({
    hasData: loaded,
    error,
    isEmpty: conversations.length === 0,
  });

  const updatedSinceVisit = useMemo(
    () => countNewSince(previousVisit, conversations.map((conversation) => conversation.lastMessageAt)),
    [previousVisit, conversations]
  );

  /**
   * A time, not an adjective. This list is driven by a realtime subscription
   * rather than a poll, so the useful pair is "it was right at HH:MM" and "it
   * does not need a refresh" — an agent staring at an empty inbox is usually
   * wondering which of the two is failing.
   */
  const inboxFreshness =
    loadedAt === null
      ? undefined
      : `Last checked ${formatDateTime(loadedAt)}. New messages appear here without a refresh.`;

  const onSend = async () => {
    if (!selectedId || !reply.trim()) {
      return;
    }
    setSending(true);
    try {
      await sendAgentReply(selectedId, reply.trim());
      setReply('');
      await loadThread(selectedId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to send the reply.');
    } finally {
      setSending(false);
    }
  };

  // Both of these were bare awaits. A refused Close/Reopen/Assign threw past
  // them as an unhandled rejection: no banner, and loadInbox() never ran -- so
  // the row stayed exactly as it was and the operator could not tell a refusal
  // from a success. onSend already had this shape; these two did not.
  const onStatus = async (status: SupportStatus) => {
    if (!selectedId) {
      return;
    }
    try {
      await setStatus(selectedId, status);
      await loadInbox();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to update this conversation.');
    }
  };

  const onAssignMe = async () => {
    if (!selectedId) {
      return;
    }
    try {
      await assignConversation(selectedId, 'me');
      await loadInbox();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to assign this conversation.');
    }
  };

  return (
    <section className="page inbox-page">
      <div className="inbox-list card">
        {/* `aria-pressed`, because the `active` class is the ONLY thing that
            said which filter was on. A sighted operator reads it instantly
            from the fill; a screen reader got five identically-announced
            buttons and no way to tell which one was applied -- so the list
            below could be filtered to "open" with nothing saying so. The two
            other toggle groups in this console (BroadcastsPage, and the risk
            signals list) already set it, so this was an inconsistency rather
            than an open question. */}
        <div className="inbox-filters">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`btn btn-ghost ${statusFilter === filter ? 'active' : ''}`}
              aria-pressed={statusFilter === filter}
              onClick={() => setStatusFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        {error ? <ErrorBanner message={error} onRetry={() => void loadInbox()} /> : null}
        {/* `loaded` already kept the empty state honest, but its false branch
            was the list container, so a first load drew the skeleton and an
            empty list at once and a failed load drew an empty list under the
            banner. The view state names 'error' separately, so that case can
            render nothing and let the banner speak for itself. */}
        {listState === 'loading' ? <SkeletonRows count={6} /> : null}
        {listState === 'empty' ? (
          <EmptyState {...emptyInboxCopy(statusFilter)} note={inboxFreshness} />
        ) : null}
        {/* A count, in words, above the list. The per-row markers answer
            "which ones", but on a list long enough to scroll the operator
            still has to scan the whole thing to learn whether the answer is
            "none" — which is the question they opened the page with. */}
        {listState === 'ready' && updatedSinceVisit > 0 ? (
          <div className="muted">
            {updatedSinceVisit} {updatedSinceVisit === 1 ? 'conversation has' : 'conversations have'} new activity since
            your last visit
          </div>
        ) : null}
        {listState === 'ready' ? (
          <div className="inbox-items">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`inbox-item ${selectedId === conversation.id ? 'selected' : ''}`}
                // `aria-current`, not `aria-pressed`: this is "which item in
                // the list am I looking at", not a control that stays pushed.
                aria-current={selectedId === conversation.id}
                onClick={() => setSelectedId(conversation.id)}
              >
                <div className="inbox-item-head">
                  <span className="inbox-item-name">{conversation.customerName}</span>
                  <StatusBadge label={conversation.status} tone={getSupportTone(conversation.status)} />
                </div>
                <div className="muted">
                  {new Date(conversation.lastMessageAt).toLocaleString()}
                  {isNewSince(previousVisit, conversation.lastMessageAt) ? <UpdatedSinceMarker /> : null}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="inbox-thread card">
        {!selected ? (
          /* "Pick a conversation on the left" is an instruction, and an
             instruction pointing at a list that is empty, still loading or
             failed is a second wrong answer stacked on the first. Gated on
             `ready` for the same reason ObservabilityPage gates its own
             "Select an alert" — the list's own state is already saying the
             true thing a few pixels to the left. */
          listState === 'ready' ? (
            <EmptyState
              title="Select a conversation"
              body="Pick one on the left to read the thread and reply. Nothing is sent to the customer until you press Send."
            />
          ) : null
        ) : (
          <>
            <header className="inbox-thread-head">
              <div>
                <h3>{selected.customerName}</h3>
                <StatusBadge label={selected.status} tone={getSupportTone(selected.status)} />
              </div>
              <div className="inbox-actions">
                <button type="button" className="btn btn-ghost" onClick={() => void onAssignMe()}>
                  Assign to me
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void onStatus('pending')}>
                  Pending
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void onStatus('closed')}>
                  Close
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void onStatus('open')}>
                  Reopen
                </button>
              </div>
            </header>

            {threadError ? (
              <ErrorBanner message={threadError} onRetry={() => void loadThread(selected.id)} />
            ) : null}

            <div className="inbox-messages">
              {messages.map((message) => (
                <div key={message.id} className={`bubble bubble-${message.senderType}`}>
                  <p>{message.body}</p>
                  <span className="muted">{new Date(message.createdAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>

            <div className="inbox-composer">
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Type a reply…"
                rows={3}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={sending || !reply.trim()}
                onClick={() => void onSend()}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
