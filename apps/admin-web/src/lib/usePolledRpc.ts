import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 20000;

export function usePolledRpc<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

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
    const interval = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      activeRef.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  return { data, loading, error, refresh };
}
