import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { usePartnerRestaurant } from './usePartnerRestaurant';
import { db } from '../services/firebase/config';
import { isTerminalOrderStatus, normalizeOrderStatus } from '../domain/orders';

export type PartnerOrder = {
  id: string;
  assignment?: {
    courierName?: string | null;
  } | null;
  createdAt?: {
    toDate?: () => Date;
  } | null;
  deliveryAddress?: string | null;
  deliveryLocation?: {
    address?: string | null;
    shortAddress?: string | null;
    note?: string | null;
  } | null;
  fulfillmentType?: string | null;
  items?: { id?: string; name?: string; price?: number; quantity?: number }[];
  payment?: {
    status?: string | null;
  } | null;
  pricing?: {
    total?: number | null;
  } | null;
  restaurantId?: string | null;
  restaurantName?: string | null;
  status?: string | null;
  timeline?: Record<string, unknown> | null;
  total?: number | null;
};

export const usePartnerOrders = () => {
  const { error: restaurantError, loading: restaurantLoading, restaurant } = usePartnerRestaurant();
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
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
        })) as PartnerOrder[];

        setOrders(nextOrders);
        setError(null);
        setLoading(false);
      },
      (nextError) => {
        console.error('Error loading partner orders:', nextError);
        setOrders([]);
        setError(nextError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const restaurantOrders = useMemo(() => {
    if (!restaurant) {
      return [];
    }

    return orders.filter((order) => {
      if (order.restaurantId && order.restaurantId === restaurant.id) {
        return true;
      }

      if (order.restaurantName && restaurant.name) {
        return order.restaurantName.trim().toLowerCase() === restaurant.name.trim().toLowerCase();
      }

      return false;
    });
  }, [orders, restaurant]);

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
