import { useEffect, useState } from 'react';
import { orderRealtimeTopic, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import { getDispatchOrderDetail } from '../services/dispatchReadModel';
import { supabase } from '../services/supabase/config';

export type DispatchOrderDetail = {
  id: string;
  assignment?: {
    courierId?: string | null;
    courierName?: string | null;
    dispatchId?: string | null;
    dispatchOwnerId?: string | null;
  } | null;
  deliveryAddress?: string | null;
  deliveryLocation?: {
    address?: string | null;
    note?: string | null;
    shortAddress?: string | null;
  } | null;
  customerPhone?: string | null;
  fulfillmentType?: string | null;
  items?: {
    id?: string;
    name?: string;
    price?: number;
    quantity?: number;
  }[];
  payment?: {
    method?: string | null;
    status?: string | null;
  } | null;
  pricing?: {
    total?: number | null;
  } | null;
  restaurantName?: string | null;
  status?: string | null;
  timeline?: Record<string, unknown> | null;
  total?: number | null;
  events?: {
    actorUid?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    eventType: string;
    id: string;
    note?: string | null;
  }[];
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

    let cancelled = false;

    const loadOrder = async () => {
      try {
        const nextData = await getDispatchOrderDetail(orderId);

        if (cancelled) {
          return;
        }

        setOrder(nextData.order as DispatchOrderDetail);
        setError(null);
      } catch (nextError: any) {
        if (cancelled) {
          return;
        }

        console.error('Error loading dispatch order:', nextError);
        setOrder(null);
        setError(nextError.message ?? 'Order not found');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadOrder();
    const unsubscribe = subscribeToRealtimeChanges(supabase, [orderRealtimeTopic(orderId)], () => {
      void loadOrder();
    });
    // Slow fallback poll in case the realtime connection drops silently.
    const interval = setInterval(() => {
      void loadOrder();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [orderId]);

  return { error, loading, order };
};
