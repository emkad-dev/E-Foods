import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { usePartnerRestaurant } from './usePartnerRestaurant';
import { db } from '../services/firebase/config';
import type { PartnerOrder } from './usePartnerOrders';

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

    const unsubscribe = onSnapshot(
      doc(db, 'orders', orderId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setOrder(null);
          setError('Order not found');
          setLoading(false);
          return;
        }

        setOrder({
          id: snapshot.id,
          ...snapshot.data(),
        } as PartnerOrder);
        setError(null);
        setLoading(false);
      },
      (nextError) => {
        console.error('Error loading partner order:', nextError);
        setOrder(null);
        setError(nextError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [orderId]);

  const hasAccess = useMemo(() => {
    if (!order || !restaurant) {
      return true;
    }

    if (order.restaurantId && order.restaurantId === restaurant.id) {
      return true;
    }

    if (order.restaurantName && restaurant.name) {
      return order.restaurantName.trim().toLowerCase() === restaurant.name.trim().toLowerCase();
    }

    return false;
  }, [order, restaurant]);

  return {
    error: hasAccess ? error : 'This order does not belong to your restaurant profile.',
    loading,
    order: hasAccess ? order : null,
  };
};
