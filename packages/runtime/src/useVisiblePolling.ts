import { useEffect, useRef } from 'react';

import { createVisiblePoller, type VisiblePoller } from './visiblePoller';

/**
 * Runs `onTick` every `intervalMs` — but only while `isVisible`.
 *
 * Replaces the bare `setInterval` that used to sit in each polling effect. Those
 * timers ran for as long as the component was mounted, so a backgrounded app or
 * a hidden tab kept issuing requests nobody was waiting for. Gating them is the
 * whole point: freshness while visible is unchanged, and idle cost goes to zero.
 *
 * Returning to visible fires one immediate catch-up tick, so a user coming back
 * does not wait out the remainder of an interval to see current data. A first
 * mount does not tick — call sites already issue their own initial load.
 *
 * `onTick` is read through a ref, so passing a fresh closure on every render is
 * safe and does not restart the interval. Errors thrown by `onTick` propagate
 * exactly as they did before; this hook adds no I/O and swallows nothing.
 *
 * Visibility comes from each app's `useAppVisibility` adapter — `AppState` on the
 * React Native apps (which react-native-web maps to page visibility) and
 * `document.visibilitychange` on admin-web.
 */
export const useVisiblePolling = (onTick: () => void, intervalMs: number, isVisible: boolean) => {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  // Read during render so the poller-creation effect below always sees the
  // current value, including when it re-runs because intervalMs changed.
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  const pollerRef = useRef<VisiblePoller | null>(null);

  useEffect(() => {
    const poller = createVisiblePoller(() => onTickRef.current(), intervalMs);
    pollerRef.current = poller;
    poller.setVisible(isVisibleRef.current);

    return () => {
      poller.stop();
      pollerRef.current = null;
    };
  }, [intervalMs]);

  useEffect(() => {
    pollerRef.current?.setVisible(isVisible);
  }, [isVisible]);
};
