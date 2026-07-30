import { useEffect, useState } from 'react';

const isDocumentVisible = () => {
  if (typeof document === 'undefined') {
    // Fail open: degrade to the old always-polling behaviour rather than to
    // never polling. Too many requests is a cost problem; no requests is a
    // correctness problem.
    return true;
  }

  return document.visibilityState === 'visible';
};

/**
 * True while this browser tab is in the foreground.
 *
 * The admin dashboard is the worst polling case in the system — parked on a
 * second monitor it used to poll indefinitely with nobody watching — so this
 * feeds `useVisiblePolling` to stop the timers whenever the tab is hidden.
 */
export const useAppVisibility = () => {
  const [isVisible, setIsVisible] = useState(isDocumentVisible);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    // Re-read on mount: the tab may have changed state between the initial
    // useState and this effect running.
    handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
};
