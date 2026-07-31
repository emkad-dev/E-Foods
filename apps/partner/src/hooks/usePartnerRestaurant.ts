import { useCallback, useEffect, useRef, useState } from 'react';
import { RESTAURANTS_REALTIME_TOPIC, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { useAuth } from '../contexts/AuthContext';
import type { RestaurantDocument } from '../domain/entities';
import { getPartnerRestaurantContext } from '../services/partnerReadModel';
import { supabase } from '../services/supabase/config';

export type RestaurantProfile = RestaurantDocument;

const POLL_INTERVAL_MS = 60000;

export const usePartnerRestaurant = () => {
  const { user } = useAuth();
  const [restaurants, setRestaurants] = useState<RestaurantProfile[]>([]);
  const [claimableRestaurants, setClaimableRestaurants] = useState<RestaurantProfile[]>([]);
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

      setRestaurants(nextContext.restaurants);
      setClaimableRestaurants(nextContext.claimableRestaurants);
      setRestaurant(nextContext.restaurant);
      setRequiresVerifiedLink(nextContext.requiresVerifiedLink);
      setError(null);
    } catch (nextError: any) {
      if (!activeRef.current) {
        return;
      }

      console.error('Error loading partner restaurant:', nextError);
      setRestaurants([]);
      setClaimableRestaurants([]);
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
      setClaimableRestaurants([]);
      setRestaurant(null);
      setLoading(false);
      return;
    }

    activeRef.current = true;

    void loadContext();
    const unsubscribe = subscribeToRealtimeChanges(supabase, [RESTAURANTS_REALTIME_TOPIC], () => {
      void loadContext();
    });

    return () => {
      activeRef.current = false;
      unsubscribe();
    };
  }, [loadContext, user]);

  // Slow fallback poll in case the realtime connection drops silently. Paused while
  // the app is backgrounded; returning to the foreground fires one catch-up read.
  useVisiblePolling(
    () => {
      void loadContext();
    },
    POLL_INTERVAL_MS,
    isVisible
  );

  return {
    claimableRestaurants,
    error,
    loading,
    restaurants,
    requiresVerifiedLink,
    restaurant,
  };
};
