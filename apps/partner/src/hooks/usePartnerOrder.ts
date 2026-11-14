import { useCallback, useEffect, useRef, useState } from 'react';
import { orderRealtimeTopic, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import { toUserMessage } from '../../../../packages/observability/src/userMessage';
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
      setError(toUserMessage(nextError, 'Order not found'));
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [orderId]);

  // A fresh read for the order screen to check what an action actually did after
  // its call failed (the reply may have been lost while the server applied it).
  // Returns the order, or null when this read fails too. Unlike `loadOrder`, a
  // failure here leaves the order on screen: the screen reports the action's
  // failure, and blanking the page over a read that also hit a bad connection
  // would hide the order the kitchen is working on.
  const reload = useCallback(async (): Promise<PartnerOrder | null> => {
    if (!orderId) {
      return null;
    }

    try {
      const nextData = await getPartnerRestaurantOrder(orderId);
      const nextOrder = nextData.order as PartnerOrder;

      if (activeRef.current) {
        setOrder(nextOrder);
        setError(null);
      }

      return nextOrder;
    } catch (nextError) {
      console.warn('Could not reload partner order after a failed action:', nextError);
      return null;
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
    reload,
  };
};
