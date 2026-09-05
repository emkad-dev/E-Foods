import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getDispatchShiftSlots, type DispatchShiftSlot } from '../services/dispatchReadModel';

export const useDispatchShiftSlots = () => {
  const { loading: authLoading, user } = useAuth();
  const [slots, setSlots] = useState<DispatchShiftSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      setSlots([]);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const nextData = await getDispatchShiftSlots();

        if (!active) {
          return;
        }

        setSlots(nextData.slots ?? []);
        setError(null);
      } catch (nextError: any) {
        if (!active) {
          return;
        }

        console.error('Error loading dispatch shift slots:', nextError);
        setSlots([]);
        setError(nextError.message ?? 'Unable to load shift slots right now.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [authLoading, user]);

  return {
    error,
    loading,
    refresh: async () => {
      if (!user) {
        return;
      }

      try {
        const nextData = await getDispatchShiftSlots();
        setSlots(nextData.slots ?? []);
        setError(null);
      } catch (nextError: any) {
        setError(nextError.message ?? 'Unable to load shift slots right now.');
      }
    },
    slots,
  };
};
