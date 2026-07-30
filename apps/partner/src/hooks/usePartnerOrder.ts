import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { orderRealtimeTopic, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { usePartnerRestaurant } from './usePartnerRestaurant';
import type { PartnerOrder } from './usePartnerOrders';
import { getPartnerRestaurantOrder } from '../services/partnerReadModel';
import { supabase } from '../services/supabase/config';

const POLL_INTERVAL_MS = 30000;

export const usePartnerOrder = (orderId: string | null | undefined) => {
  const { restaurant } = usePartnerRestaurant();
  const [order, setOrder] = useState<PartnerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Hoisted out of the effect so the fallback poll can call the same loader.
  // Mirrors the activeRef guard used in admin-web's usePolledRpc.
  const activeRef = useRef(true);
  const isVisible = useAppStateVisibility();

  const loadOrder = useCallback(async () => {
    if (!orderId) {
      return;
    }

    try {
      const nextData = await getPartnerRestaurantOrder(orderId);

      if (!activeRef.current) {
        return;
      }

      setOrder(nextData.order as PartnerOrder);
      setError(null);
    } catch (nextError: any) {
      if (!activeRef.current) {
        return;
      }

      console.error('Error loading partner order:', nextError);
      setOrder(null);
      setError(nextError.message ?? 'Order not found');
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [orderId]);

  useEffect(() => {
    activeRef.current = true;

    if (!orderId) {
      setOrder(null);
      setLoading(false);

      return () => {
        activeRef.current = false;
      };
    }

    void loadOrder();
    const unsubscribe = subscribeToRealtimeChanges(supabase, [orderRealtimeTopic(orderId)], () => {
      void loadOrder();
    });

    return () => {
      activeRef.current = false;
      unsubscribe();
    };
  }, [loadOrder, orderId]);

  // Slow fallback poll in case the realtime connection drops silently. Paused
  // while the app is backgrounded; resuming forces one catch-up read.
  useVisiblePolling(
    () => {
      void loadOrder();
    },
    POLL_INTERVAL_MS,
    isVisible
  );

  const hasAccess = useMemo(() => {
    if (!order || !restaurant) {
      return true;
    }

    return order.restaurantId === restaurant.id;
  }, [order, restaurant]);

  return {
    error: hasAccess ? error : 'This order does not belong to your restaurant profile.',
    loading,
    order: hasAccess ? order : null,
  };
};
