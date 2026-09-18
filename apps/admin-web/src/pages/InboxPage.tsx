import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
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

  const loadInbox = useCallback(async () => {
    try {
      const res = await getInbox({
        status: statusFilter === 'all' ? undefined : statusFilter,
        scope: 'all',
      });
      setConversations(res.conversations);
      setError(null);
      setLoaded(true);
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
          <EmptyState title="No conversations" body="Customer messages will show up here." />
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
                <div className="muted">{new Date(conversation.lastMessageAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="inbox-thread card">
        {!selected ? (
          <EmptyState title="Select a conversation" body="Pick a conversation on the left to reply." />
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
