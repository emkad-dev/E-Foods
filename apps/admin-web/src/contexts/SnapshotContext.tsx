import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getAdminDashboardSnapshot, type AdminDashboardSnapshot } from '../services/platformReads';

const POLL_INTERVAL_MS = 20000;

const EMPTY_SNAPSHOT: AdminDashboardSnapshot = {
  dispatchProfiles: [],
  orders: [],
  restaurants: [],
  users: [],
};

interface SnapshotContextValue {
  snapshot: AdminDashboardSnapshot;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

const SnapshotContext = createContext<SnapshotContextValue | null>(null);

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const nextSnapshot = await getAdminDashboardSnapshot();

      if (!activeRef.current) {
        return;
      }

      setSnapshot(nextSnapshot);
      setLastUpdated(new Date());
      setError(null);
    } catch (nextError) {
      if (!activeRef.current) {
        return;
      }

      setError(nextError instanceof Error ? nextError.message : 'Unable to load the admin snapshot right now.');
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, []);

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

  const value = useMemo(
    () => ({ snapshot, loading, error, lastUpdated, refresh }),
    [snapshot, loading, error, lastUpdated, refresh]
  );

  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>;
}

export function useSnapshot() {
  const context = useContext(SnapshotContext);

  if (!context) {
    throw new Error('useSnapshot must be used inside SnapshotProvider');
  }

  return context;
}
