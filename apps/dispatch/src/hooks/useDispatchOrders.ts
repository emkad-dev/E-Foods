import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ORDERS_REALTIME_TOPIC, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import type { RealtimeResourceSubscribe } from '../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import type { OrderDocument } from '../domain/entities';
import { isTerminalOrderStatus, normalizeOrderStatus } from '../domain/orders';
import { getDispatchDeliveryQueue, type DispatchDeliveryOffer } from '../services/dispatchReadModel';
import { supabase } from '../services/supabase/config';
import { sortDispatchHistoryOrders } from '../utils/dispatchQueue';
import { useAuth } from '../contexts/AuthContext';

export type DispatchOrder = OrderDocument;

const FALLBACK_MS = 120000;

export const useDispatchOrders = () => {
  const { loading: authLoading, user } = useAuth();
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [offers, setOffers] = useState<DispatchDeliveryOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isVisible = useAppStateVisibility();
  const activeRef = useRef(false);

  const loadOrders = useCallback(
    async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
      try {
        if (mode === 'refresh') {
          setRefreshing(true);
        }

        const nextData = await getDispatchDeliveryQueue();

        if (!activeRef.current) {
          return;
        }

        setOrders(nextData.orders as DispatchOrder[]);
        setOffers((nextData.offers ?? []) as DispatchDeliveryOffer[]);
        setError(null);
      } catch (nextError: any) {
        if (!activeRef.current) {
          return;
        }

        console.error('Error loading dispatch orders:', nextError);
        setError(nextError.message ?? 'Unable to load dispatch orders right now.');
      } finally {
        if (mode === 'refresh') {
          setRefreshing(false);
        }

        if (mode === 'initial' && activeRef.current) {
          setLoading(false);
        }
      }
    },
    []
  );

  const enabled = !authLoading && Boolean(user);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      setOrders([]);
      setOffers([]);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    activeRef.current = true;

    return () => {
      activeRef.current = false;
    };
  }, [authLoading, user]);

  const loadOrdersInBackground = useCallback(() => loadOrders('background'), [loadOrders]);

  const subscribe = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) =>
      subscribeToRealtimeChanges(supabase, [ORDERS_REALTIME_TOPIC], () => onChanged(), onStatusChange),
    []
  );

  // Realtime is the transport; the fallback poll only fires while the
  // channel is not confirmed SUBSCRIBED, and only while the app is visible.
  useRealtimeResource({
    subscribe,
    load: loadOrdersInBackground,
    isVisible,
    fallbackMs: FALLBACK_MS,
    enabled,
  });

  const deliveryOrders = useMemo(
    () => orders.filter((order) => (order.fulfillmentType ?? 'delivery') === 'delivery'),
    [orders]
  );

  const activeDeliveryOrders = useMemo(
    () => deliveryOrders.filter((order) => !isTerminalOrderStatus(order.status)),
    [deliveryOrders]
  );

  const completedDeliveryOrders = useMemo(
    () => sortDispatchHistoryOrders(deliveryOrders.filter((order) => isTerminalOrderStatus(order.status))),
    [deliveryOrders]
  );

  const awaitingPickupCount = useMemo(
    () =>
      activeDeliveryOrders.filter((order) => {
        const normalizedStatus = normalizeOrderStatus(order.status);
        return ['accepted', 'preparing', 'ready_for_pickup'].includes(normalizedStatus);
      }).length,
    [activeDeliveryOrders]
  );

  const onTheWayCount = useMemo(
    () =>
      activeDeliveryOrders.filter((order) => {
        const normalizedStatus = normalizeOrderStatus(order.status);
        return ['picked_up', 'on_the_way'].includes(normalizedStatus);
      }).length,
    [activeDeliveryOrders]
  );

  const deliveredCount = useMemo(
    () =>
      deliveryOrders.filter((order) => normalizeOrderStatus(order.status) === 'delivered').length,
    [deliveryOrders]
  );

  return {
    activeDeliveryOrders,
    awaitingPickupCount,
    completedDeliveryOrders,
    deliveredCount,
    error,
    loading,
    offers,
    onTheWayCount,
    orders,
    refreshing,
    reload: () => loadOrders('refresh'),
  };
};
