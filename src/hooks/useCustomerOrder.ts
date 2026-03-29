// src/hooks/useCustomerOrder.ts
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase/config';

export type Order = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  customerId: string;
  items: any[];
  total: number;
  status: 'pending' | 'preparing' | 'ready' | 'delivered';
  createdAt: any;
  deliveryAddress: string;
  // ...
};

export const useCustomerOrder = (orderId: string) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;

    const unsubscribe = onSnapshot(
      doc(db, 'orders', orderId),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          setOrder({ id: docSnapshot.id, ...docSnapshot.data() } as Order);
        } else {
          setError('Order not found');
        }
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [orderId]);

  return { order, loading, error };
};