import { useCallback, useEffect, useRef, useState } from 'react';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import type { AddressRecord, OrderDocument, OrderPaymentSummary, OrderPriceBreakdown } from '../domain/entities';
import type { FulfillmentType } from '../domain/orders';
import { getCustomerOrderDetail } from '../services/customerReadModel';
import { supabase } from '../services/supabase/config';

const POLL_INTERVAL_MS = 30000;

export type Order = OrderDocument & {
  id: string;
  deliveryLocation?: AddressRecord | null;
  fulfillmentType?: FulfillmentType;
  pricing?: OrderPriceBreakdown;
  payment?: OrderPaymentSummary;
};

export const useCustomerOrder = (orderId: string, customerId: string | null) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isVisible = useAppStateVisibility();
  // Replaces the per-effect `cancelled` flag: loadOrder is now shared between the
  // subscription effect and the visibility-gated poll, so the guard has to outlive
  // any single effect run.
  const activeRef = useRef(false);

  const loadOrder = useCallback(async () => {
    if (!orderId || !customerId) {
      return;
    }

    try {
      const nextData = await getCustomerOrderDetail(orderId);

      if (!activeRef.current) {
        return;
      }

      if (nextData.order.customerId !== customerId) {
        setOrder(null);
        setError('Order not found');
        return;
      }

      setOrder(nextData.order as Order);
      setError(null);
    } catch (err: any) {
      if (!activeRef.current) {
        return;
      }

      setOrder(null);
      setError(err.message ?? 'Order not found');
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [customerId, orderId]);

  useEffect(() => {
    if (!orderId || !customerId) {
      setOrder(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    activeRef.current = true;

    void loadOrder();
    const channel = supabase
      .channel(`customer-order:${orderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'CustomerOrder',
          filter: `id=eq.${orderId}`,
        },
        () => {
          void loadOrder();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'DeliveryAssignment',
          filter: `orderId=eq.${orderId}`,
        },
        () => {
          void loadOrder();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void loadOrder();
        }
      });

    return () => {
      activeRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [customerId, loadOrder, orderId]);

  // Fallback poll for a silently-dropped Realtime connection. Paused while the app
  // is backgrounded; returning to the foreground fires one immediate catch-up read.
  useVisiblePolling(
    () => {
      void loadOrder();
    },
    POLL_INTERVAL_MS,
    isVisible
  );

  return { order, loading, error };
};
