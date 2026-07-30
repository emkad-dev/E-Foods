import { useEffect } from 'react';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { supabase } from '../services/supabase/config';

const POLL_FALLBACK_MS = 30000;

// Subscribes to the `support-<conversationId>` broadcast topic emitted by the
// app-rpc edge function (event name `changed`, matching REALTIME_CHANGED_EVENT)
// so agent replies arrive live. A 30s poll mirrors the resilience pattern used
// by the customer order hooks in case a broadcast is missed — paused while the
// app is backgrounded, since a missed broadcast cannot be observed there and
// resuming forces a catch-up read.
export function useSupportThreadRealtime(conversationId: string | null, onChange: () => void) {
  const isVisible = useAppStateVisibility();

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const channel = supabase
      .channel(`support-${conversationId}`)
      .on('broadcast', { event: 'changed' }, () => {
        onChange();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, onChange]);

  useVisiblePolling(
    () => {
      if (!conversationId) {
        return;
      }

      onChange();
    },
    POLL_FALLBACK_MS,
    isVisible
  );
}
