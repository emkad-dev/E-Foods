import React, { createContext, useContext, useMemo } from 'react';
import { useDispatchOrders } from '../hooks/useDispatchOrders';
import { useRealTimeLocation, type LiveLocation } from '../hooks/useRealTimeLocation';
import { useAuth } from './AuthContext';
import { useRiderAvailability } from './RiderAvailabilityContext';

/*
  The signed-in rider's own live GPS, shared by the whole app.

  Mounted ONCE under RiderAvailabilityProvider (app/_layout.tsx). It owns the
  app's single `useRealTimeLocation` watcher so screens (the trip map) and the
  server-sync bridge read the same fix instead of each opening a watcher.

  It also owns the single `useDispatchOrders` instance behind the streaming
  decision. That hook runs its own realtime subscription / fallback poll, so
  the bridge cannot call it again: the decision it feeds (`hasActiveAssignment`,
  `transitionSignature`) is exposed through `useRiderLocationStream` instead.
*/

// Active delivery: a 15s / 25m watch (was 5s / 5m). Each sync is one edge
// invocation against the Free plan's 500K/month quota; 5s cost ~300 per
// delivery (~4.5M/month at 500 orders/day). See utils/locationSyncThrottle.ts
// for the client-side gate, the 60s keep-alive and the transition sync.
const ACTIVE_LOCATION_INTERVAL_MS = 15000;
const ACTIVE_DISTANCE_INTERVAL_M = 25;
const IDLE_HEARTBEAT_INTERVAL_MS = 60000;
const ACTIVE_MIN_ACCURACY_M = 50;
const IDLE_MIN_ACCURACY_M = 200;

type RiderLocationStream = {
  hasActiveAssignment: boolean;
  isStreaming: boolean;
  location: LiveLocation | null;
  // Changes whenever one of this rider's deliveries changes status (picked up,
  // on the way...), which triggers an immediate sync so ETA/arrival logic sees
  // the position at the transition rather than up to 60s later.
  transitionSignature: string;
};

const RiderLocationContext = createContext<RiderLocationStream | undefined>(undefined);

export const RiderLocationProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  // Battery/cost gate: only stream location while this rider is Available or
  // actually holds a live delivery, not just because their queue screen is showing unowned
  // manual-queue work they could self-assign. `activeDeliveryOrders` (from
  // useDispatchOrders) is deliberately broader than that for a `dispatch`
  // role - dispatchGetDeliveryQueue surfaces both this rider's own assigned
  // orders AND unowned orders any dispatcher could pick up (see
  // isUnownedDispatchableOrder in _shared/domains/dispatch.ts) - so gating on
  // its length alone would keep GPS running for every rider whenever ANY
  // order anywhere is sitting unclaimed. `assignment.courierId === user.uid`
  // narrows it to orders this specific rider is actually the assigned
  // courier for.
  const { activeDeliveryOrders } = useDispatchOrders();
  const myActiveOrders = useMemo(
    () => activeDeliveryOrders.filter((order) => order.assignment?.courierId === user?.uid),
    [activeDeliveryOrders, user?.uid]
  );
  const hasActiveAssignment = myActiveOrders.length > 0;
  const transitionSignature = useMemo(
    () =>
      myActiveOrders
        .map((order) => `${order.id}:${order.status}`)
        .sort()
        .join('|'),
    [myActiveOrders]
  );
  // Presence: an idle rider who is Available must still ping, otherwise SP-1's
  // freshness gate never sees them and they can never be offered work.
  // Offline + no assignment streams nothing.
  const { isAvailable } = useRiderAvailability();
  const shouldStream = isAvailable || hasActiveAssignment;
  const isStreaming = user?.role === 'dispatch' && shouldStream;
  // Cadence: a live delivery keeps a tracking beat; an idle-but-Available rider
  // only needs a slow heartbeat inside the freshness window. Idle keeps
  // distanceInterval 0 so a parked rider still beats (Android ANDs
  // time+distance); active uses 25m and relies on the 60s keep-alive in the
  // sync bridge.
  const { location } = useRealTimeLocation({
    enabled: isStreaming,
    highAccuracy: hasActiveAssignment,
    updateInterval: hasActiveAssignment ? ACTIVE_LOCATION_INTERVAL_MS : IDLE_HEARTBEAT_INTERVAL_MS,
    distanceInterval: hasActiveAssignment ? ACTIVE_DISTANCE_INTERVAL_M : 0,
    // Idle presence only needs "alive", so tolerate coarse indoor/parked fixes
    // (otherwise they're all dropped, the rider goes stale and never gets work);
    // a live delivery keeps the strict 50m bar customer tracking needs.
    minAccuracy: hasActiveAssignment ? ACTIVE_MIN_ACCURACY_M : IDLE_MIN_ACCURACY_M,
  });

  const value = useMemo(
    () => ({ hasActiveAssignment, isStreaming, location, transitionSignature }),
    [hasActiveAssignment, isStreaming, location, transitionSignature]
  );

  return <RiderLocationContext.Provider value={value}>{children}</RiderLocationContext.Provider>;
};

// The sync bridge's view: the fix plus the decision that gates it.
export const useRiderLocationStream = () => {
  const context = useContext(RiderLocationContext);

  if (!context) {
    throw new Error('useRiderLocationStream must be used within RiderLocationProvider');
  }

  return context;
};

// The rider's latest GPS fix, or null while not streaming / no fix yet.
export const useRiderLocation = (): LiveLocation | null => useRiderLocationStream().location;
