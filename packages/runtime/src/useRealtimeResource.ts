import { useEffect, useRef } from 'react';

import { createRealtimeResourceController, type RealtimeChannelStatus } from './realtimeResource';

// Re-exported so callers can type their `subscribe` implementation without
// reaching into `realtimeResource` directly.
export type { RealtimeChannelStatus };

export type RealtimeResourceSubscribe = (
  onChanged: () => void,
  onStatusChange: (status: RealtimeChannelStatus) => void
) => () => void;

export type UseRealtimeResourceOptions = {
  /**
   * Opens the realtime subscription (a broadcast topic via
   * `subscribeToRealtimeChanges`, or -- for the two screens where RLS
   * permits it -- `postgres_changes`) and reports status transitions.
   * Called once per mount while `enabled`; the returned function tears it
   * down. Give it a stable identity (e.g. `useCallback` keyed on the id it
   * closes over) so an id change resubscribes instead of being silently
   * ignored.
   */
  subscribe: RealtimeResourceSubscribe;
  /**
   * Refetches the resource. Called once on mount, on every `changed`
   * broadcast (debounced), on foreground/tab-focus resume, and by the
   * fallback poll. Same stability requirement as `subscribe`.
   */
  load: () => void | Promise<void>;
  /**
   * App-foreground / tab-focus signal, supplied by the caller so this hook
   * never has to know whether it is running under React Native (`AppState`,
   * via `useAppStateVisibility`) or a browser (`document.visibilitychange`).
   * That split lives in each app; this hook stays platform-free.
   */
  isVisible: boolean;
  /**
   * Only used while the channel is not `SUBSCRIBED`. Defaults to 120s per
   * the B1 cost-reduction plan -- a disconnected-only safety net, not a
   * steady poll running alongside realtime.
   */
  fallbackMs?: number;
  /** Trailing debounce window for `changed` broadcasts. */
  debounceMs?: number;
  /** False skips subscribing/loading entirely (e.g. no id yet). */
  enabled?: boolean;
};

const DEFAULT_FALLBACK_MS = 120_000;
const DEFAULT_DEBOUNCE_MS = 400;

/**
 * One shared hook for every "live" screen: subscribes to realtime, refetches
 * on mount/changed/foreground-resume, and runs a 120s fallback poll only
 * while the channel is not confirmed SUBSCRIBED. Replaces the per-hook
 * `setInterval(loadX, 30000)` boilerplate that used to run unconditionally.
 */
export const useRealtimeResource = ({
  subscribe,
  load,
  isVisible,
  fallbackMs = DEFAULT_FALLBACK_MS,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  enabled = true,
}: UseRealtimeResourceOptions): void => {
  // Read during render so the mount-time effect below always sees the
  // current value without needing `isVisible` in its dependency array (that
  // would tear down and recreate the subscription on every foreground /
  // background transition, which the second effect handles instead).
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  const controllerRef = useRef<ReturnType<typeof createRealtimeResourceController> | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = createRealtimeResourceController(() => void load(), fallbackMs, debounceMs);
    controllerRef.current = controller;
    controller.setVisible(isVisibleRef.current);

    void load();

    const unsubscribe = subscribe(
      () => controller.notifyChanged(),
      (status) => controller.setChannelStatus(status)
    );

    return () => {
      controller.stop();
      controllerRef.current = null;
      unsubscribe();
    };
  }, [enabled, fallbackMs, debounceMs, subscribe, load]);

  useEffect(() => {
    controllerRef.current?.setVisible(isVisible);
  }, [isVisible]);
};
