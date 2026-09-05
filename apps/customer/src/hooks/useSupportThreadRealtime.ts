import { useCallback, useRef } from 'react';
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

  // `onChange` is read through a ref (the pattern useVisiblePolling.ts:26-27
  // already uses for `onTick`) rather than passed straight into
  // useRealtimeResource's `load`. `load` sits in that hook's mount-effect
  // dependency array, so a caller that ever passes an inline arrow instead of
  // a `useCallback(…, [])`-stabilized one (support.tsx currently does)  would
  // otherwise unsubscribe/refetch/resubscribe on every render. Reading
  // through a ref makes `load`'s identity stable regardless of what the
  // caller passes.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(() => {
    onChangeRef.current();
  }, []);

  const subscribe = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) =>
      subscribeToRealtimeChanges(supabase, [supportThreadTopic(conversationId ?? '')], () => onChanged(), onStatusChange),
    [conversationId]
  );

  useRealtimeResource({
    subscribe,
    load,
    isVisible,
    fallbackMs: FALLBACK_MS,
    enabled: Boolean(conversationId),
  });
}
