import { useCallback, useEffect, useRef, useState } from 'react';
import { RESTAURANTS_REALTIME_TOPIC, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import type { RealtimeResourceSubscribe } from '../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { useAuth } from '../contexts/AuthContext';
import type { RestaurantDocument } from '../domain/entities';
import { getPartnerRestaurantContext } from '../services/partnerReadModel';
import { supabase } from '../services/supabase/config';

export type RestaurantProfile = RestaurantDocument;

// Was a 60s unconditional poll; the B1 cost-reduction plan raises every
// fallback to 120s and gates it to only run while the channel is not
// confirmed SUBSCRIBED.
const FALLBACK_MS = 120000;

export const usePartnerRestaurant = () => {
  const { user } = useAuth();
  const [restaurants, setRestaurants] = useState<RestaurantProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresVerifiedLink, setRequiresVerifiedLink] = useState(false);
  const [restaurant, setRestaurant] = useState<RestaurantProfile | null>(null);

  const isVisible = useAppStateVisibility();
  // Shared by the subscription effect and the visibility-gated poll, so the
  // in-flight guard has to outlive any single effect run.
  const activeRef = useRef(false);

  const loadContext = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      const nextContext = await getPartnerRestaurantContext();

      if (!activeRef.current) {
        return;
      }

      // `nextContext.claimableRestaurants` is deliberately dropped rather than
      // stored. The backend builds that list with a different rule - it keeps
      // the restaurant the account already manages in it - so rendering it
      // would offer a "Confirm link" button for the store this login already
      // controls. The account screen derives its own list by excluding the
      // linked restaurant, and that is the rule the UI wants. Holding the
      // server list in state as well meant a set of rows nothing read, redrawing
      // the hook's consumers on every realtime refresh. The response shape is
      // untouched; only this client stops keeping a copy.
      setRestaurants(nextContext.restaurants);
      setRestaurant(nextContext.restaurant);
      setRequiresVerifiedLink(nextContext.requiresVerifiedLink);
      setError(null);
    } catch (nextError: any) {
      if (!activeRef.current) {
        return;
      }

      console.error('Error loading partner restaurant:', nextError);
      setRestaurants([]);
      setRestaurant(null);
      setRequiresVerifiedLink(false);
      setError(nextError.message ?? 'Unable to load restaurant context right now.');
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setRestaurants([]);
      setRestaurant(null);
      setLoading(false);
      return;
    }

    activeRef.current = true;

    return () => {
      activeRef.current = false;
    };
  }, [user]);

  const subscribe = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) =>
      subscribeToRealtimeChanges(supabase, [RESTAURANTS_REALTIME_TOPIC], () => onChanged(), onStatusChange),
    []
  );

  // Realtime is the transport; the fallback poll only fires while the
  // channel is not confirmed SUBSCRIBED, and only while the app is visible.
  useRealtimeResource({
    subscribe,
    load: loadContext,
    isVisible,
    fallbackMs: FALLBACK_MS,
    enabled: Boolean(user),
  });

  return {
    error,
    loading,
    restaurants,
    requiresVerifiedLink,
    restaurant,
  };
};
