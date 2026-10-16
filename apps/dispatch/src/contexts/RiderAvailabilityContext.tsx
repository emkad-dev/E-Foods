import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatchRiders, type DispatchRider } from '../hooks/useDispatchRiders';
import { setDispatchAvailability } from '../services/dispatchOrderActions';
import { useAuth } from './AuthContext';

/*
  The signed-in rider's own online/offline state, shared by the whole app.

  Mounted ONCE under AuthProvider (app/_layout.tsx). It owns the single
  `useDispatchRiders` instance, so profile.tsx and the root layout's location
  gate read the same data and the app makes one dispatchGetRiders fetch /
  realtime subscription / fallback poll rather than one per consumer.

  `dispatchSetAvailability` emits no broadcast, so nothing would otherwise tell
  the fetched list that the status changed. `setAvailable` therefore re-fetches
  after every call, success or failure, and the fetched status is the source of
  truth. The optimistic value is only a short-lived overlay, cleared by that
  re-fetch whether or not it matches.
*/

type Overlay = { status: string; uid: string };

type RiderAvailabilityContextType = {
  isAvailable: boolean;
  isOnline: boolean;
  refresh: () => Promise<void>;
  riders: DispatchRider[];
  ridersError: string | null;
  setAvailable: (available: boolean) => Promise<void>;
  status: string | null;
};

const RiderAvailabilityContext = createContext<RiderAvailabilityContextType | undefined>(undefined);

export const RiderAvailabilityProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { error: ridersError, refresh, riders } = useDispatchRiders();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const inFlightRef = useRef(false);
  const uidRef = useRef(uid);

  // Sign-out or a different rider: drop any optimistic state so a re-login can
  // never inherit the previous session's value, and release the in-flight latch.
  useEffect(() => {
    uidRef.current = uid;
    inFlightRef.current = false;
    setOverlay(null);
  }, [uid]);

  const serverStatus = useMemo(
    () => (uid ? riders.find((rider) => rider.id === uid)?.status ?? null : null),
    [riders, uid]
  );
  const status = overlay && overlay.uid === uid ? overlay.status : serverStatus;

  const setAvailable = useCallback(
    async (available: boolean) => {
      if (!uid) {
        throw new Error('Sign in again before changing your availability.');
      }

      // Two quick taps must not both fire, nor capture each other's
      // half-applied state.
      if (inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      setOverlay({ status: available ? 'Available' : 'Offline', uid });

      try {
        const result = await setDispatchAvailability(available);

        if (uidRef.current === uid) {
          setOverlay({ status: result.status, uid });
        }
      } catch (error) {
        // Revert at once; the server may or may not have applied it, so the
        // re-fetch below decides what the switch finally shows.
        if (uidRef.current === uid) {
          setOverlay(null);
        }
        throw error;
      } finally {
        try {
          await refresh();
        } finally {
          if (uidRef.current === uid) {
            setOverlay(null);
          }
          inFlightRef.current = false;
        }
      }
    },
    [refresh, uid]
  );

  const value = useMemo<RiderAvailabilityContextType>(
    () => ({
      // 'Available' is the one status the dispatcher can offer work to.
      isAvailable: status === 'Available',
      // Online = not Offline; a rider mid-delivery is online but not offerable.
      isOnline: status !== null && !status.toLowerCase().includes('offline'),
      refresh,
      riders,
      ridersError,
      setAvailable,
      status,
    }),
    [refresh, riders, ridersError, setAvailable, status]
  );

  return <RiderAvailabilityContext.Provider value={value}>{children}</RiderAvailabilityContext.Provider>;
};

export const useRiderAvailability = () => {
  const context = useContext(RiderAvailabilityContext);

  if (!context) {
    throw new Error('useRiderAvailability must be used within RiderAvailabilityProvider');
  }

  return context;
};
