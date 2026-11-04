import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { OrderDocument } from '../domain/entities';
import { pickOrderAwaitingConfirmation } from '../domain/orderConfirmation';
import { getCustomerOrders } from '../services/customerReadModel';

/**
 * The customer's most recent order that is waiting for them to confirm receipt,
 * for the Home prompt.
 *
 * One read each time the screen gains focus, and nothing else: no timer, no
 * Realtime subscription. This app's backend cost is driven by RPC invocations,
 * and a prompt that only has to be right when the customer lands on Home does
 * not earn a poll. The read goes through the shared 12s read cache, so
 * flipping between tabs does not re-invoke the function either.
 *
 * Guests (`customerId` null) make no call at all. A failed read leaves the
 * prompt absent: Home has no error UI for this, and the order screen and the
 * push reminders still carry the same message.
 */
export const useAwaitingConfirmationOrder = (customerId: string | null) => {
  const [order, setOrder] = useState<OrderDocument | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!customerId) {
        setOrder(null);
        return undefined;
      }

      let active = true;
      getCustomerOrders()
        .then(({ orders }) => {
          if (active) {
            setOrder(pickOrderAwaitingConfirmation<OrderDocument>(orders));
          }
        })
        .catch(() => undefined);

      return () => {
        active = false;
      };
    }, [customerId])
  );

  return order;
};
