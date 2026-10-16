import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { setDispatchAvailability } from '../services/dispatchOrderActions';
import { useDispatchRiders } from './useDispatchRiders';

/*
  The signed-in rider's own online/offline state, readable from anywhere under
  AuthProvider (profile.tsx toggles it; app/_layout.tsx gates location
  streaming on it).

  `useDispatchRiders` keeps its rider list in per-instance React state, so a
  toggle made on the profile screen is invisible to the root layout until that
  instance's next realtime refresh. This module-level override closes the gap:
  the toggle writes the status it wants (optimistically, then the server's
  answer), every hook instance reads it immediately, and it drops away once the
  fetched rider record agrees. Keyed by uid so one rider's override can never
  leak into the next sign-in.
*/

type Override = { status: string; uid: string } | null;

let override: Override = null;
const listeners = new Set<() => void>();

const setOverride = (next: Override) => {
  override = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getOverride = () => override;

export const useRiderAvailability = () => {
  const { user } = useAuth();
  const { riders } = useDispatchRiders();
  const currentOverride = useSyncExternalStore(subscribe, getOverride, getOverride);

  const serverStatus = useMemo(
    () => (user ? riders.find((rider) => rider.id === user.uid)?.status ?? null : null),
    [riders, user]
  );
  const activeOverride = currentOverride && currentOverride.uid === user?.uid ? currentOverride : null;
  const status = activeOverride?.status ?? serverStatus;

  // Once the fetched record shows the status we wrote, the override has done its
  // job; drop it so later server-side changes (e.g. Delivering) show through.
  useEffect(() => {
    if (activeOverride && serverStatus === activeOverride.status) {
      setOverride(null);
    }
  }, [activeOverride, serverStatus]);

  // 'Available' is the one status the dispatcher can offer work to.
  const isAvailable = status === 'Available';
  // Online = not Offline. A rider mid-delivery ('Delivering', 'Pickup delayed')
  // is online but not offerable; the profile switch reflects this.
  const isOnline = status !== null && !status.toLowerCase().includes('offline');

  /**
   * Optimistically sets the rider online/offline, calls the RPC, and reverts
   * then rethrows on failure so the caller can show the error.
   */
  const setAvailable = useCallback(
    async (available: boolean) => {
      if (!user?.uid) {
        throw new Error('Sign in again before changing your availability.');
      }

      const previous = override;
      setOverride({ status: available ? 'Available' : 'Offline', uid: user.uid });

      try {
        const result = await setDispatchAvailability(available);
        setOverride({ status: result.status, uid: user.uid });
      } catch (error) {
        setOverride(previous);
        throw error;
      }
    },
    [user?.uid]
  );

  return { isAvailable, isOnline, setAvailable, status };
};
