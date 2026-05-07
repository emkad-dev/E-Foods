import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import type {
  AddressRecord,
  OrderPriceBreakdown,
  OrderPaymentSummary,
  OrderDocument,
} from '../domain/entities';
import type { FulfillmentType } from '../domain/orders';
import { db } from '../services/firebase/config';

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

    const unsubscribe = onSnapshot(
      doc(db, 'orders', orderId),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data() as Order;

          if (data.customerId !== customerId) {
            setOrder(null);
            setError('Order not found');
          } else {
            setOrder({ ...data, id: docSnapshot.id });
            setError(null);
          }
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
  }, [customerId, orderId]);

  return { order, loading, error };
};
