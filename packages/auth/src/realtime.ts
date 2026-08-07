import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export const ORDERS_REALTIME_TOPIC = 'orders';
export const RIDERS_REALTIME_TOPIC = 'dispatch-riders';
export const RESTAURANTS_REALTIME_TOPIC = 'restaurants';
export const PROMOS_REALTIME_TOPIC = 'promos';
export const SUPPORT_INBOX_TOPIC = 'support-inbox';
export const REALTIME_CHANGED_EVENT = 'changed';

export const orderRealtimeTopic = (orderId: string) => `order-${orderId}`;
// Mirrors supabase/functions/_shared/realtime.ts's supportThreadTopic --
// the broadcaster (edge function) and the subscriber (this client package)
// must agree on the topic name.
export const supportThreadTopic = (conversationId: string) => `support-${conversationId}`;

export type RealtimeChangeHandler = (payload: Record<string, unknown>) => void;

// Collapses every raw Supabase channel status (SUBSCRIBED, TIMED_OUT,
// CLOSED, CHANNEL_ERROR, and the transient "joining" state before the first
// callback) down to the one distinction realtime-resource consumers act on.
export type RealtimeSubscriptionStatus = 'SUBSCRIBED' | 'DISCONNECTED';

type TopicSubscription = {
  channel: RealtimeChannel;
  handlers: Set<RealtimeChangeHandler>;
  statusHandlers: Set<(status: RealtimeSubscriptionStatus) => void>;
  status: RealtimeSubscriptionStatus;
};

// One websocket channel per topic, shared across hooks. Subscribing to the
// same Phoenix topic twice on one socket is not supported, so channels are
// ref-counted here and removed once the last handler unsubscribes.
const topicSubscriptions = new Map<string, TopicSubscription>();

const getTopicSubscription = (supabase: SupabaseClient, topic: string): TopicSubscription => {
  const existing = topicSubscriptions.get(topic);
  if (existing) {
    return existing;
  }

  const handlers = new Set<RealtimeChangeHandler>();
  const statusHandlers = new Set<(status: RealtimeSubscriptionStatus) => void>();
  const subscription: TopicSubscription = {
    channel: undefined as unknown as RealtimeChannel,
    handlers,
    statusHandlers,
    status: 'DISCONNECTED',
  };

  subscription.channel = supabase
    .channel(topic)
    .on('broadcast', { event: REALTIME_CHANGED_EVENT }, (message) => {
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      for (const handler of handlers) {
        handler(payload);
      }
    })
    .subscribe((rawStatus) => {
      const nextStatus: RealtimeSubscriptionStatus = rawStatus === 'SUBSCRIBED' ? 'SUBSCRIBED' : 'DISCONNECTED';
      if (subscription.status === nextStatus) {
        return;
      }

      subscription.status = nextStatus;
      for (const handler of statusHandlers) {
        handler(nextStatus);
      }
    });

  topicSubscriptions.set(topic, subscription);
  return subscription;
};

export const subscribeToRealtimeChanges = (
  supabase: SupabaseClient,
  topics: string[],
  onChange: RealtimeChangeHandler,
  onStatusChange?: (status: RealtimeSubscriptionStatus) => void
): (() => void) => {
  const uniqueTopics = Array.from(new Set(topics.filter(Boolean)));

  for (const topic of uniqueTopics) {
    const subscription = getTopicSubscription(supabase, topic);
    subscription.handlers.add(onChange);

    if (onStatusChange) {
      subscription.statusHandlers.add(onStatusChange);
      // Replay the current status immediately so a subscriber that joins an
      // already-connected (or still-connecting) topic learns it right away,
      // rather than waiting for the next transition -- topics are shared
      // and may already be SUBSCRIBED by the time a second hook joins.
      onStatusChange(subscription.status);
    }
  }

  return () => {
    for (const topic of uniqueTopics) {
      const subscription = topicSubscriptions.get(topic);
      if (!subscription) {
        continue;
      }

      subscription.handlers.delete(onChange);
      if (onStatusChange) {
        subscription.statusHandlers.delete(onStatusChange);
      }
      if (subscription.handlers.size === 0) {
        topicSubscriptions.delete(topic);
        void supabase.removeChannel(subscription.channel);
      }
    }
  };
};
