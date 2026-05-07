import { useEffect, useMemo, useState } from 'react';
import { usePartnerRestaurant } from './usePartnerRestaurant';
import type { OrderDocument } from '../domain/entities';
import { isTerminalOrderStatus, normalizeOrderStatus } from '../domain/orders';
import { getPartnerRestaurantOrders } from '../services/partnerReadModel';

export type PartnerOrder = OrderDocument;

export const usePartnerOrders = () => {
  const { error: restaurantError, loading: restaurantLoading, restaurant } = usePartnerRestaurant();
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurant?.id) {
      setOrders([]);
      setError(restaurantError ?? null);
      setLoading(restaurantLoading);
      return;
    }

    let cancelled = false;

    const loadOrders = async () => {
      try {
        const nextData = await getPartnerRestaurantOrders();

        if (cancelled) {
          return;
        }

        setOrders(nextData.orders as PartnerOrder[]);
        setError(null);
      } catch (nextError: any) {
        if (cancelled) {
          return;
        }

        console.error('Error loading partner orders:', nextError);
        setOrders([]);
        setError(nextError.message ?? 'Unable to load restaurant orders right now.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadOrders();
    const interval = setInterval(() => {
      void loadOrders();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [restaurant?.id, restaurantError, restaurantLoading]);

  const restaurantOrders = useMemo(() => orders, [orders]);

  const activeOrders = useMemo(
    () => restaurantOrders.filter((order) => !isTerminalOrderStatus(order.status)),
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
    restaurant,
  };
};
