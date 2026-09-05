import { useCallback, useEffect, useRef, useState } from 'react';
import { orderRealtimeTopic, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import type { RealtimeResourceSubscribe } from '../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import type { PartnerOrder } from './usePartnerOrders';
import { getPartnerRestaurantOrder } from '../services/partnerReadModel';
import { supabase } from '../services/supabase/config';

const FALLBACK_MS = 120000;

export const usePartnerOrder = (orderId: string | null | undefined) => {
  const [order, setOrder] = useState<PartnerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isVisible = useAppStateVisibility();
  const activeRef = useRef(false);

  const enabled = Boolean(orderId);

  useEffect(() => {
    if (!enabled) {
      setOrder(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    activeRef.current = true;

    return () => {
      activeRef.current = false;
    };
  }, [enabled]);

  const loadOrder = useCallback(async () => {
    if (!orderId) {
      return;
    }

    try {
      const nextData = await getPartnerRestaurantOrder(orderId);

      if (!activeRef.current) {
        return;
      }

      setOrder(nextData.order as PartnerOrder);
      setError(null);
    } catch (nextError: any) {
      if (!activeRef.current) {
        return;
      }

      console.error('Error loading partner order:', nextError);
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
      subscribeToRealtimeChanges(supabase, [orderRealtimeTopic(orderId ?? '')], () => onChanged(), onStatusChange),
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

  return {
    error,
    loading,
    order,
  };
};
