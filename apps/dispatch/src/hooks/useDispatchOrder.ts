import { useCallback, useEffect, useRef, useState } from 'react';
import { orderRealtimeTopic, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { useAuth } from '../contexts/AuthContext';
import { getDispatchOrderDetail } from '../services/dispatchReadModel';
import { supabase } from '../services/supabase/config';

const POLL_INTERVAL_MS = 30000;

export type DispatchOrderDetail = {
  id: string;
  assignment?: {
    courierId?: string | null;
    courierName?: string | null;
    courierPhone?: string | null;
    courierLatitude?: number | null;
    courierLongitude?: number | null;
    courierUpdatedAt?: string | null;
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
  const { loading: authLoading, user } = useAuth();
  const [order, setOrder] = useState<DispatchOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Hoisted out of the effect so the fallback poll can call the same loader.
  const activeRef = useRef(true);
  const isVisible = useAppStateVisibility();

  const loadOrder = useCallback(async () => {
    if (authLoading || !orderId || !user) {
      return;
    }

    try {
      const nextData = await getDispatchOrderDetail(orderId);

      if (!activeRef.current) {
        return;
      }

      setOrder(nextData.order as DispatchOrderDetail);
      setError(null);
    } catch (nextError: any) {
      if (!activeRef.current) {
        return;
      }

      console.error('Error loading dispatch order:', nextError);
      setOrder(null);
      setError(nextError.message ?? 'Order not found');
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [authLoading, orderId, user]);

  useEffect(() => {
    activeRef.current = true;

    if (authLoading) {
      return () => {
        activeRef.current = false;
      };
    }

    if (!orderId) {
      setOrder(null);
      setLoading(false);
      setError('Missing order id');

      return () => {
        activeRef.current = false;
      };
    }

    if (!user) {
      setOrder(null);
      setError(null);
      setLoading(false);

      return () => {
        activeRef.current = false;
      };
    }

    void loadOrder();
    const unsubscribe = subscribeToRealtimeChanges(supabase, [orderRealtimeTopic(orderId)], () => {
      void loadOrder();
    });

    return () => {
      activeRef.current = false;
      unsubscribe();
    };
  }, [authLoading, loadOrder, orderId, user]);

  // Slow fallback poll in case the realtime connection drops silently. Paused
  // while the app is backgrounded; resuming forces one catch-up read.
  useVisiblePolling(
    () => {
      void loadOrder();
    },
    POLL_INTERVAL_MS,
    isVisible
  );

  return { error, loading, order };
};
