import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../services/firebase/config';
import { isTerminalOrderStatus, normalizeOrderStatus } from '../domain/orders';

export type DispatchOrder = {
  id: string;
  createdAt?: {
    toDate?: () => Date;
  } | null;
  customerId?: string;
  deliveryAddress?: string | null;
  deliveryLocation?: {
    address?: string | null;
    shortAddress?: string | null;
    note?: string | null;
  } | null;
  fulfillmentType?: string | null;
  items?: { quantity?: number }[];
  payment?: {
    status?: string | null;
  } | null;
  pricing?: {
    total?: number | null;
  } | null;
  restaurantName?: string | null;
  status?: string | null;
  total?: number | null;
};

export const useDispatchOrders = () => {
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ordersQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const nextOrders = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        })) as DispatchOrder[];

        setOrders(nextOrders);
        setError(null);
        setLoading(false);
      },
      (nextError) => {
        console.error('Error loading dispatch orders:', nextError);
        setError(nextError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
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
