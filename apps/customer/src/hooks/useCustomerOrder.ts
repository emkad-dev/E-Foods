import { useEffect, useState } from 'react';
import type { AddressRecord, OrderDocument, OrderPaymentSummary, OrderPriceBreakdown } from '../domain/entities';
import type { FulfillmentType } from '../domain/orders';
import { getCustomerOrderDetail } from '../services/customerReadModel';
import { supabase } from '../services/supabase/config';

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

  useEffect(() => {
    if (!orderId || !customerId) {
      setOrder(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    const loadOrder = async () => {
      try {
        const nextData = await getCustomerOrderDetail(orderId);

        if (cancelled) {
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
        if (cancelled) {
          return;
        }

        setOrder(null);
        setError(err.message ?? 'Order not found');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

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

    const interval = setInterval(() => {
      void loadOrder();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [customerId, orderId]);

  return { order, loading, error };
};
