import { useCallback } from 'react';
import { subscribeToRealtimeChanges, supportThreadTopic } from '../../../../packages/auth/src';
import type { RealtimeResourceSubscribe } from '../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { supabase } from '../services/supabase/config';

const FALLBACK_MS = 120000;

// Subscribes to the `support-<conversationId>` broadcast topic emitted by the
// app-rpc edge function (event name `changed`, matching REALTIME_CHANGED_EVENT)
// so agent replies arrive live. The 120s fallback poll only runs while the
// channel is not confirmed SUBSCRIBED, and is paused while the app is
// backgrounded.
export function useSupportThreadRealtime(conversationId: string | null, onChange: () => void) {
  const isVisible = useAppStateVisibility();

  const subscribe = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) =>
      subscribeToRealtimeChanges(supabase, [supportThreadTopic(conversationId ?? '')], () => onChanged(), onStatusChange),
    [conversationId]
  );

  useRealtimeResource({
    subscribe,
    load: onChange,
    isVisible,
    fallbackMs: FALLBACK_MS,
    enabled: Boolean(conversationId),
  });
}
