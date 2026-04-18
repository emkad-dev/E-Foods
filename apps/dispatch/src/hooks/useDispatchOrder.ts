import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase/config';

export type DispatchOrderDetail = {
  id: string;
  assignment?: {
    courierId?: string | null;
    courierName?: string | null;
    dispatchId?: string | null;
  } | null;
  deliveryAddress?: string | null;
  deliveryLocation?: {
    address?: string | null;
    note?: string | null;
    shortAddress?: string | null;
  } | null;
  fulfillmentType?: string | null;
  items?: {
    id?: string;
    name?: string;
    price?: number;
    quantity?: number;
  }[];
  payment?: {
    status?: string | null;
  } | null;
  pricing?: {
    total?: number | null;
  } | null;
  restaurantName?: string | null;
  status?: string | null;
  timeline?: Record<string, unknown> | null;
  total?: number | null;
};

export const useDispatchOrder = (orderId: string) => {
  const [order, setOrder] = useState<DispatchOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      setLoading(false);
      setError('Missing order id');
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
        } as DispatchOrderDetail);
        setError(null);
        setLoading(false);
      },
      (nextError) => {
        console.error('Error loading dispatch order:', nextError);
        setOrder(null);
        setError(nextError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [orderId]);

  return { error, loading, order };
};
