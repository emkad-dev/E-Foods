import { useEffect, useState } from 'react';
import type { AddressRecord, OrderDocument, OrderPaymentSummary, OrderPriceBreakdown } from '../domain/entities';
import type { FulfillmentType } from '../domain/orders';
import { getCustomerOrderDetail } from '../services/customerReadModel';

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
    const interval = setInterval(() => {
      void loadOrder();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [customerId, orderId]);

  return { order, loading, error };
};
