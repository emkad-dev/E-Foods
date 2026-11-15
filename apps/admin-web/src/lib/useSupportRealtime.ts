import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * The removal of the previous `support-inbox` channel, if one is still in
 * flight. `supabase.channel(topic)` hands back any channel already registered
 * under that topic, and `removeChannel` only unregisters it once the leave has
 * been acknowledged. Creating the next channel before then returns the one
 * that is leaving, whose `subscribe()` is a no-op -- realtime silently dead.
 * Every new subscription therefore waits for the last removal to finish.
 */
let pendingRemoval: Promise<unknown> = Promise.resolve();

// Subscribes to the `support-inbox` broadcast topic emitted by the app-rpc edge
// function (event name `changed`, matching REALTIME_CHANGED_EVENT). Invokes the
// callback on any inbox change so the page can refresh.
//
// Subscribes ONCE per mount. The callback used to be an effect dependency, so
// every conversation click or filter change tore the channel down and
// re-created it, which hit the leaving-channel trap above after the first
// click. The latest callback is read from a ref instead.
export function useSupportRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let active = true;
    let channel: RealtimeChannel | null = null;

    void pendingRemoval.then(() => {
      if (!active) {
        return;
      }

      channel = supabase
        .channel('support-inbox')
        .on('broadcast', { event: 'changed' }, () => onChangeRef.current())
        .subscribe();
    });

    return () => {
      active = false;

      if (channel) {
        pendingRemoval = supabase.removeChannel(channel).catch(() => undefined);
      }
    };
  }, []);
}
