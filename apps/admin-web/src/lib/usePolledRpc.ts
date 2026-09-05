import { useCallback, useEffect, useRef, useState } from 'react';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import { useDocumentVisibility } from './useDocumentVisibility';

// No broadcast topic covers the mutations this hook's callers depend on
// (dispatch/partner application review, role changes) -- see
// docs/rls-posture.md and supabase/functions/_shared/realtime.ts for the
// full topic list. This is a slow, visibility-gated safety-net poll, not a
// realtime accelerant like the other B1 hooks; the interval is still raised
// from 20s to 120s and now pauses while the tab is hidden.
const POLL_INTERVAL_MS = 120000;

export function usePolledRpc<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const isVisible = useDocumentVisibility();

  const refresh = useCallback(async () => {
    try {
      const next = await fetcher();

      if (!activeRef.current) {
        return;
      }

      setData(next);
      setError(null);
    } catch (nextError) {
      if (!activeRef.current) {
        return;
      }

      setError(nextError instanceof Error ? nextError.message : 'Unable to load data right now.');
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [fetcher]);

  useEffect(() => {
    activeRef.current = true;
    void refresh();

    return () => {
      activeRef.current = false;
    };
  }, [refresh]);

  // Paused while the tab is hidden; returning to the foreground fires one
  // immediate catch-up read.
  useVisiblePolling(() => void refresh(), POLL_INTERVAL_MS, isVisible);

  return { data, loading, error, refresh };
}
