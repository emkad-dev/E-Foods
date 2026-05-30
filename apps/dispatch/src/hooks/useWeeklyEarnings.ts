import { useCallback, useEffect, useState } from 'react';
import {
  getDispatchWeeklyEarnings,
  type WeeklyEarningsReport,
} from '../services/dispatchReadModel';

export const useWeeklyEarnings = () => {
  const [report, setReport] = useState<WeeklyEarningsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    try {
      if (mode === 'refresh') {
        setRefreshing(true);
      }

      const nextReport = await getDispatchWeeklyEarnings();
      setReport(nextReport);
      setError(null);
    } catch (nextError: any) {
      console.error('Error loading weekly earnings:', nextError);
      setError(nextError.message ?? 'Unable to load weekly earnings.');
    } finally {
      if (mode === 'refresh') {
        setRefreshing(false);
      }

      if (mode === 'initial') {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return {
    error,
    loading,
    refresh: () => loadReport('refresh'),
    refreshing,
    report,
  };
};
