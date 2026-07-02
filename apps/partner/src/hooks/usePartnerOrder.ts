import { useEffect, useMemo, useState } from 'react';
import { orderRealtimeTopic, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import { usePartnerRestaurant } from './usePartnerRestaurant';
import type { PartnerOrder } from './usePartnerOrders';
import { getPartnerRestaurantOrder } from '../services/partnerReadModel';
import { supabase } from '../services/supabase/config';

export const usePartnerOrder = (orderId: string | null | undefined) => {
  const { restaurant } = usePartnerRestaurant();
  const [order, setOrder] = useState<PartnerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadOrder = async () => {
      try {
        const nextData = await getPartnerRestaurantOrder(orderId);

        if (cancelled) {
          return;
        }

        setOrder(nextData.order as PartnerOrder);
        setError(null);
      } catch (nextError: any) {
        if (cancelled) {
          return;
        }

        console.error('Error loading partner order:', nextError);
        setOrder(null);
        setError(nextError.message ?? 'Order not found');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadOrder();
    const unsubscribe = subscribeToRealtimeChanges(supabase, [orderRealtimeTopic(orderId)], () => {
      void loadOrder();
    });
    // Slow fallback poll in case the realtime connection drops silently.
    const interval = setInterval(() => {
      void loadOrder();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [orderId]);

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
