import { useCallback, useEffect, useMemo, useState } from 'react';
import { ORDERS_REALTIME_TOPIC, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import type { OrderDocument, RestaurantDocument } from '../domain/entities';
import { isTerminalOrderStatus, normalizeOrderStatus } from '../domain/orders';
import { getPartnerRestaurantOrders } from '../services/partnerReadModel';
import { supabase } from '../services/supabase/config';
import { sortKitchenHistoryOrders } from '../utils/partnerQueue';

export type PartnerOrder = OrderDocument;

export const usePartnerOrders = () => {
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [restaurant, setRestaurant] = useState<RestaurantDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(
    async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
      try {
        if (mode === 'refresh') {
          setRefreshing(true);
        }

        const nextData = await getPartnerRestaurantOrders();
        setOrders(nextData.orders as PartnerOrder[]);
        setRestaurant(nextData.restaurant);
        setError(null);
      } catch (nextError: any) {
        console.error('Error loading partner orders:', nextError);
        setOrders([]);
        setRestaurant(null);
        setError(nextError.message ?? 'Unable to load restaurant orders right now.');
      } finally {
        if (mode === 'refresh') {
          setRefreshing(false);
        }

        if (mode === 'initial') {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (restaurant?.id) {
      return;
    }

    void loadOrders('initial');
  }, [loadOrders, restaurant?.id]);

  useEffect(() => {
    if (!restaurant?.id) {
      return;
    }

    let cancelled = false;

    const guardedLoad = async (mode: 'background' = 'background') => {
      if (cancelled) {
        return;
      }

      await loadOrders(mode);
    };

    const unsubscribe = subscribeToRealtimeChanges(supabase, [ORDERS_REALTIME_TOPIC], (payload) => {
      // Global topic carries every order change; skip refetches for other restaurants when tagged.
      const changedRestaurantId = typeof payload.restaurantId === 'string' ? payload.restaurantId : null;
      if (changedRestaurantId && restaurant.id && changedRestaurantId !== restaurant.id) {
        return;
      }

      void guardedLoad();
    });
    // Slow fallback poll in case the realtime connection drops silently.
    const interval = setInterval(() => {
      void guardedLoad();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [loadOrders, restaurant?.id]);

  const restaurantOrders = useMemo(() => orders, [orders]);

  const activeOrders = useMemo(
    () => restaurantOrders.filter((order) => !isTerminalOrderStatus(order.status)),
    [restaurantOrders]
  );

  const historyOrders = useMemo(
    () => sortKitchenHistoryOrders(restaurantOrders.filter((order) => isTerminalOrderStatus(order.status))),
    [restaurantOrders]
  );

  const incomingOrders = useMemo(
    () => activeOrders.filter((order) => normalizeOrderStatus(order.status) === 'placed'),
    [activeOrders]
  );

  const preparingOrders = useMemo(
    () =>
      activeOrders.filter((order) => {
        const status = normalizeOrderStatus(order.status);
        return ['accepted', 'preparing', 'ready_for_pickup'].includes(status);
      }),
    [activeOrders]
  );

  const completedToday = useMemo(
    () => restaurantOrders.filter((order) => normalizeOrderStatus(order.status) === 'delivered').length,
    [restaurantOrders]
  );

  return {
    activeOrders,
    completedToday,
    error,
    incomingOrders,
    loading,
    orders: restaurantOrders,
    preparingOrders,
    refreshing,
    reload: () => loadOrders('refresh'),
    restaurant,
    historyOrders,
  };
};
