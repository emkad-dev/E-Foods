import { useEffect } from 'react';
import { supabase } from './supabase';

// Subscribes to the `support-inbox` broadcast topic emitted by the app-rpc edge
// function (event name `changed`, matching REALTIME_CHANGED_EVENT). Invokes the
// callback on any inbox change so the page can refresh.
export function useSupportRealtime(onChange: () => void) {
  useEffect(() => {
    const channel = supabase
      .channel('support-inbox')
      .on('broadcast', { event: 'changed' }, () => onChange())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [onChange]);
}
