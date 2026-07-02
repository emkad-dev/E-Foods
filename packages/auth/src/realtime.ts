import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export const ORDERS_REALTIME_TOPIC = 'orders';
export const RIDERS_REALTIME_TOPIC = 'dispatch-riders';
export const RESTAURANTS_REALTIME_TOPIC = 'restaurants';
export const REALTIME_CHANGED_EVENT = 'changed';

export const orderRealtimeTopic = (orderId: string) => `order-${orderId}`;

export type RealtimeChangeHandler = (payload: Record<string, unknown>) => void;

type TopicSubscription = {
  channel: RealtimeChannel;
  handlers: Set<RealtimeChangeHandler>;
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
  const channel = supabase
    .channel(topic)
    .on('broadcast', { event: REALTIME_CHANGED_EVENT }, (message) => {
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      for (const handler of handlers) {
        handler(payload);
      }
    })
    .subscribe();

  const subscription: TopicSubscription = { channel, handlers };
  topicSubscriptions.set(topic, subscription);
  return subscription;
};

export const subscribeToRealtimeChanges = (
  supabase: SupabaseClient,
  topics: string[],
  onChange: RealtimeChangeHandler
): (() => void) => {
  const uniqueTopics = Array.from(new Set(topics.filter(Boolean)));

  for (const topic of uniqueTopics) {
    getTopicSubscription(supabase, topic).handlers.add(onChange);
  }

  return () => {
    for (const topic of uniqueTopics) {
      const subscription = topicSubscriptions.get(topic);
      if (!subscription) {
        continue;
      }

      subscription.handlers.delete(onChange);
      if (subscription.handlers.size === 0) {
        topicSubscriptions.delete(topic);
        void supabase.removeChannel(subscription.channel);
      }
    }
  };
};
