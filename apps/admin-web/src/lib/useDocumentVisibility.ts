import { useEffect, useState } from 'react';

/**
 * True while the browser tab is in the foreground. admin-web has no
 * react-native dependency (plain React + Vite), so it cannot use the RN
 * apps' `useAppStateVisibility` (packages/runtime/src/useAppStateVisibility,
 * backed by `AppState`) -- this is the Page Visibility API equivalent,
 * feeding the same `isVisible` signal that `useVisiblePolling` and
 * `useRealtimeResource` expect from every app.
 */
export const useDocumentVisibility = (): boolean => {
  const [isVisible, setIsVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleChange = () => setIsVisible(document.visibilityState === 'visible');
    handleChange();
    document.addEventListener('visibilitychange', handleChange);

    return () => {
      document.removeEventListener('visibilitychange', handleChange);
    };
  }, []);

  return isVisible;
};
