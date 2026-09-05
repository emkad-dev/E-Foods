import { useCallback, useEffect, useRef, useState } from 'react';
import { orderRealtimeTopic, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import type { RealtimeResourceSubscribe } from '../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { useAuth } from '../contexts/AuthContext';
import { getDispatchOrderDetail } from '../services/dispatchReadModel';
import { supabase } from '../services/supabase/config';

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

const FALLBACK_MS = 120000;

export const useDispatchOrder = (orderId: string) => {
  const { loading: authLoading, user } = useAuth();
  const [order, setOrder] = useState<DispatchOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isVisible = useAppStateVisibility();
  const activeRef = useRef(false);

  const enabled = !authLoading && Boolean(orderId) && Boolean(user);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!orderId) {
      setOrder(null);
      setLoading(false);
      setError('Missing order id');
      return;
    }

    if (!user) {
      setOrder(null);
      setError(null);
      setLoading(false);
      return;
    }

    activeRef.current = true;

    return () => {
      activeRef.current = false;
    };
  }, [authLoading, orderId, user]);

  const loadOrder = useCallback(async () => {
    if (!orderId) {
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
  }, [orderId]);

  const subscribe = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) =>
      subscribeToRealtimeChanges(supabase, [orderRealtimeTopic(orderId)], () => onChanged(), onStatusChange),
    [orderId]
  );

  // Realtime is the transport; the fallback poll only fires while the
  // channel is not confirmed SUBSCRIBED, and only while the app is visible.
  useRealtimeResource({
    subscribe,
    load: loadOrder,
    isVisible,
    fallbackMs: FALLBACK_MS,
    enabled,
  });

  return { error, loading, order };
};
