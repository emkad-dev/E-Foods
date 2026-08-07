import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import { useDocumentVisibility } from '../lib/useDocumentVisibility';
import { getAdminDashboardSnapshot, type AdminDashboardSnapshot } from '../services/platformReads';

// The snapshot aggregates orders, restaurants, dispatch profiles, and users.
// Orders and restaurants have broadcast topics; dispatch-profile creation
// (via application approval) and user/role changes do not broadcast
// anything today, so this stays a slow, visibility-gated safety-net poll
// rather than a realtime-driven fallback like the other B1 hooks. Raised
// from 20s to 120s and now pauses while the tab is hidden.
const POLL_INTERVAL_MS = 120000;

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
  const isVisible = useDocumentVisibility();

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

    return () => {
      activeRef.current = false;
    };
  }, [refresh]);

  // Paused while the tab is hidden; returning to the foreground fires one
  // immediate catch-up read.
  useVisiblePolling(() => void refresh(), POLL_INTERVAL_MS, isVisible);

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
