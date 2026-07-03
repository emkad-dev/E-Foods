import { useEffect, useRef } from 'react';

export type UseVisibilityRefreshOptions = {
  enabled?: boolean;
  /**
   * Ignore refresh triggers that fire within this window of the previous one.
   * Prevents a double fetch when `focus` and `visibilitychange` both fire as a
   * tab is re-selected.
   */
  throttleMs?: number;
};

/**
 * Runs `onRefresh` when the browser tab becomes visible or the window regains
 * focus. Web browsers throttle and eventually freeze `setInterval` in hidden
 * tabs, so polling-based screens go stale while the admin is on another tab and
 * only recover on a manual page reload. Re-fetching on return closes that gap.
 *
 * Admin is a web-only console, so this listens to DOM visibility/focus events
 * and no-ops in any non-DOM environment.
 */
export const useVisibilityRefresh = (
  onRefresh: () => void,
  { enabled = true, throttleMs = 400 }: UseVisibilityRefreshOptions = {}
) => {
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    let lastRun = 0;

    const trigger = () => {
      const now = Date.now();
      if (now - lastRun < throttleMs) {
        return;
      }
      lastRun = now;
      refreshRef.current();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        trigger();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', trigger);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', trigger);
    };
  }, [enabled, throttleMs]);
};
