import { useEffect, useMemo, useState } from 'react';
import type { OrderDocument } from '../domain/entities';
import { isTerminalOrderStatus, normalizeOrderStatus } from '../domain/orders';
import { getDispatchDeliveryQueue } from '../services/dispatchReadModel';

export type DispatchOrder = OrderDocument;

export const useDispatchOrders = () => {
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadOrders = async () => {
      try {
        const nextData = await getDispatchDeliveryQueue();

        if (cancelled) {
          return;
        }

        setOrders(nextData.orders as DispatchOrder[]);
        setError(null);
      } catch (nextError: any) {
        if (cancelled) {
          return;
        }

        console.error('Error loading dispatch orders:', nextError);
        setError(nextError.message ?? 'Unable to load dispatch orders right now.');
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
  }, []);

  const deliveryOrders = useMemo(
    () => orders.filter((order) => (order.fulfillmentType ?? 'delivery') === 'delivery'),
    [orders]
  );

  const activeDeliveryOrders = useMemo(
    () => deliveryOrders.filter((order) => !isTerminalOrderStatus(order.status)),
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
    deliveredCount,
    error,
    loading,
    onTheWayCount,
    orders,
  };
};
