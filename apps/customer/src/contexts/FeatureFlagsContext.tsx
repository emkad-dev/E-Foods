import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeatureFlagMap } from '../../../../packages/domain/src/featureFlags';
import { getFeatureFlags } from '../services/featureFlags';
import { useAuth } from './AuthContext';

type FeatureFlagsContextValue = {
  error: string | null;
  featureFlags: FeatureFlagMap;
  loading: boolean;
  refresh: () => Promise<void>;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null);

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [featureFlags, setFeatureFlags] = useState<FeatureFlagMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!user) {
      if (activeRef.current) {
        setFeatureFlags({});
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      const result = await getFeatureFlags();
      if (!activeRef.current) {
        return;
      }

      setFeatureFlags(result.featureFlags ?? {});
      setError(null);
    } catch (nextError) {
      if (!activeRef.current) {
        return;
      }

      setError(nextError instanceof Error ? nextError.message : 'Unable to load feature flags.');
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    activeRef.current = true;

    if (!authLoading) {
      void refresh();
    }

    return () => {
      activeRef.current = false;
    };
  }, [authLoading, refresh]);

  const value = useMemo(
    () => ({ error, featureFlags, loading, refresh }),
    [error, featureFlags, loading, refresh]
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags() {
  const context = useContext(FeatureFlagsContext);

  if (!context) {
    throw new Error('useFeatureFlags must be used within FeatureFlagsProvider');
  }

  return context;
}

export function useFeatureFlag(flagKey: string) {
  const { featureFlags } = useFeatureFlags();
  return featureFlags[flagKey] === true;
}
