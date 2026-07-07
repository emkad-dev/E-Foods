import { useEffect } from 'react';
import { supabase } from '../services/supabase/config';

const POLL_FALLBACK_MS = 30000;

// Subscribes to the `support-<conversationId>` broadcast topic emitted by the
// app-rpc edge function (event name `changed`, matching REALTIME_CHANGED_EVENT)
// so agent replies arrive live. A 30s poll mirrors the resilience pattern used
// by the customer order hooks in case a broadcast is missed.
export function useSupportThreadRealtime(conversationId: string | null, onChange: () => void) {
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

    const interval = setInterval(() => {
      onChange();
    }, POLL_FALLBACK_MS);

    return () => {
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, onChange]);
}
