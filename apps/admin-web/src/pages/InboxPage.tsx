import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { useSupportRealtime } from '../lib/useSupportRealtime';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      const res = await getInbox({
        status: statusFilter === 'all' ? undefined : statusFilter,
        scope: 'all',
      });
      setConversations(res.conversations);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load the inbox.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadThread = useCallback(async (id: string) => {
    const res = await getConversation(id);
    setMessages(res.messages);
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
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

  const onStatus = async (status: SupportStatus) => {
    if (!selectedId) {
      return;
    }
    await setStatus(selectedId, status);
    await loadInbox();
  };

  const onAssignMe = async () => {
    if (!selectedId) {
      return;
    }
    await assignConversation(selectedId, 'me');
    await loadInbox();
  };

  return (
    <section className="page inbox-page">
      <div className="inbox-list card">
        <div className="inbox-filters">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`btn btn-ghost ${statusFilter === filter ? 'active' : ''}`}
              onClick={() => setStatusFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        {loading ? <LoadingBlock label="Loading inbox…" /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        {!loading && conversations.length === 0 ? (
          <EmptyState title="No conversations" body="Customer messages will show up here." />
        ) : (
          <div className="inbox-items">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`inbox-item ${selectedId === conversation.id ? 'selected' : ''}`}
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
        )}
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
