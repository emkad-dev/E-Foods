import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePartnerRestaurant } from './usePartnerRestaurant';
import type { OrderDocument } from '../domain/entities';
import { isTerminalOrderStatus, normalizeOrderStatus } from '../domain/orders';
import { getPartnerRestaurantOrders } from '../services/partnerReadModel';
import { sortKitchenHistoryOrders } from '../utils/partnerQueue';

export type PartnerOrder = OrderDocument;

export const usePartnerOrders = () => {
  const { error: restaurantError, loading: restaurantLoading, restaurant } = usePartnerRestaurant();
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
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
        setError(null);
      } catch (nextError: any) {
        console.error('Error loading partner orders:', nextError);
        setOrders([]);
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
    if (!restaurant?.id) {
      setOrders([]);
      setError(restaurantError ?? null);
      setLoading(restaurantLoading);
      return;
    }

    let cancelled = false;

    const guardedLoad = async (mode: 'initial' | 'background' = 'initial') => {
        if (cancelled) {
          return;
        }

      await loadOrders(mode);
    };

    void guardedLoad();
    const interval = setInterval(() => {
      void guardedLoad('background');
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadOrders, restaurant?.id, restaurantError, restaurantLoading]);

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
    error: error ?? restaurantError,
    incomingOrders,
    loading: loading || restaurantLoading,
    orders: restaurantOrders,
    preparingOrders,
    refreshing,
    reload: () => loadOrders('refresh'),
    restaurant,
    historyOrders,
  };
};
