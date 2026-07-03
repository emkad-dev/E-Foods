import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase/config';
import { createAdminLiveRefreshController } from './adminLiveRefreshController.js';

export type AdminLiveRefreshSubscription = {
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  filter?: string;
  schema?: string;
  table: string;
};

export type UseAdminLiveRefreshOptions = {
  channelName?: string;
  debounceMs?: number;
  enabled?: boolean;
  onRefresh: () => Promise<void>;
  pollIntervalMs?: number;
  subscriptions: readonly AdminLiveRefreshSubscription[];
};

const buildChannelName = (subscriptions: readonly AdminLiveRefreshSubscription[]) =>
  `admin-live-refresh:${subscriptions
    .map((subscription) =>
      [subscription.schema ?? 'public', subscription.table, subscription.event ?? '*', subscription.filter ?? ''].join(':')
    )
    .join('|')}`;

const attachSubscription = (channel: RealtimeChannel, subscription: AdminLiveRefreshSubscription, onChange: () => void) => {
  const payload: {
    event: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
    filter?: string;
    schema: string;
    table: string;
  } = {
    event: subscription.event ?? '*',
    schema: subscription.schema ?? 'public',
    table: subscription.table,
  };

  if (subscription.filter?.trim()) {
    payload.filter = subscription.filter.trim();
  }

  return channel.on('postgres_changes', payload, onChange);
};

export const useAdminLiveRefresh = ({
  channelName,
  debounceMs = 300,
  enabled = true,
  onRefresh,
  pollIntervalMs = 20000,
  subscriptions,
}: UseAdminLiveRefreshOptions) => {
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled || subscriptions.length === 0) {
      return;
    }

    const controller = createAdminLiveRefreshController(() => refreshRef.current(), { debounceMs });
    const channel = supabase.channel(channelName ?? buildChannelName(subscriptions));

    for (const subscription of subscriptions) {
      attachSubscription(channel, subscription, () => {
        controller.schedule();
      });
    }

    void channel.subscribe();
    controller.runNow();

    const interval = setInterval(() => {
      controller.schedule();
    }, pollIntervalMs);

    // Browsers freeze setInterval and drop the realtime websocket in hidden
    // tabs, so live changes stop arriving while the admin is away and only a
    // manual reload recovers them. Re-run immediately when the tab returns.
    const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';

    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        controller.runNow();
      }
    };
    const handleFocus = () => {
      controller.runNow();
    };

    if (hasDom) {
      document.addEventListener('visibilitychange', handleVisible);
      window.addEventListener('focus', handleFocus);
    }

    return () => {
      if (hasDom) {
        document.removeEventListener('visibilitychange', handleVisible);
        window.removeEventListener('focus', handleFocus);
      }
      clearInterval(interval);
      controller.dispose();
      void supabase.removeChannel(channel);
    };
  }, [channelName, debounceMs, enabled, pollIntervalMs, subscriptions]);
};
