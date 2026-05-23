import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OrderDocument } from '../domain/entities';
import { isTerminalOrderStatus, normalizeOrderStatus } from '../domain/orders';
import { getDispatchDeliveryQueue } from '../services/dispatchReadModel';
import { sortDispatchHistoryOrders } from '../utils/dispatchQueue';

export type DispatchOrder = OrderDocument;

export const useDispatchOrders = () => {
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(
    async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
      try {
        if (mode === 'refresh') {
          setRefreshing(true);
        }

        const nextData = await getDispatchDeliveryQueue();

        setOrders(nextData.orders as DispatchOrder[]);
        setError(null);
      } catch (nextError: any) {
        console.error('Error loading dispatch orders:', nextError);
        setError(nextError.message ?? 'Unable to load dispatch orders right now.');
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
  }, [loadOrders]);

  const deliveryOrders = useMemo(
    () => orders.filter((order) => (order.fulfillmentType ?? 'delivery') === 'delivery'),
    [orders]
  );

  const activeDeliveryOrders = useMemo(
    () => deliveryOrders.filter((order) => !isTerminalOrderStatus(order.status)),
    [deliveryOrders]
  );

  const completedDeliveryOrders = useMemo(
    () => sortDispatchHistoryOrders(deliveryOrders.filter((order) => isTerminalOrderStatus(order.status))),
    [deliveryOrders]
  );

  const awaitingPickupCount = useMemo(
    () =>
      activeDeliveryOrders.filter((order) => {
        const normalizedStatus = normalizeOrderStatus(order.status);
        return ['accepted', 'preparing', 'ready_for_pickup'].includes(normalizedStatus);
      }).length,
    [activeDeliveryOrders]
  );

  const onTheWayCount = useMemo(
    () =>
      activeDeliveryOrders.filter((order) => {
        const normalizedStatus = normalizeOrderStatus(order.status);
        return ['picked_up', 'on_the_way'].includes(normalizedStatus);
      }).length,
    [activeDeliveryOrders]
  );

  const deliveredCount = useMemo(
    () =>
      deliveryOrders.filter((order) => normalizeOrderStatus(order.status) === 'delivered').length,
    [deliveryOrders]
  );

  return {
    activeDeliveryOrders,
    awaitingPickupCount,
    completedDeliveryOrders,
    deliveredCount,
    error,
    loading,
    onTheWayCount,
    orders,
    refreshing,
    reload: () => loadOrders('refresh'),
  };
};
