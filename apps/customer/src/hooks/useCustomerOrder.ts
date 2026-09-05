import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeResourceSubscribe } from '../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import type { AddressRecord, OrderDocument, OrderPaymentSummary, OrderPriceBreakdown } from '../domain/entities';
import type { FulfillmentType } from '../domain/orders';
import { getCustomerOrderDetail } from '../services/customerReadModel';
import { supabase } from '../services/supabase/config';

// RLS self-read policies on CustomerOrder and DeliveryAssignment are applied
// in production, so `postgres_changes` works for this screen specifically --
// most other tables are service-role-only and cannot use it. See
// docs/rls-posture.md.
const FALLBACK_MS = 120000;

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

  const enabled = Boolean(orderId && customerId);

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

  const subscribe = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) => {
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
          () => onChanged()
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'DeliveryAssignment',
            filter: `orderId=eq.${orderId}`,
          },
          () => onChanged()
        )
        .subscribe((status) => onStatusChange(status === 'SUBSCRIBED' ? 'SUBSCRIBED' : 'DISCONNECTED'));

      return () => {
        void supabase.removeChannel(channel);
      };
    },
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

  return { order, loading, error };
};
