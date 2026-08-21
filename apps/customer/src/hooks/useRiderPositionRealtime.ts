import { useEffect, useRef } from 'react';
import { orderRealtimeTopic, RIDER_POSITION_EVENT } from '../../../../packages/auth/src';
import { supabase } from '../services/supabase/config';

export type RiderPosition = {
  latitude: number;
  longitude: number;
  updatedAt: string | null;
};

const readPosition = (payload: unknown): RiderPosition | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const latitude = record.latitude;
  const longitude = record.longitude;

  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : null;
  return { latitude, longitude, updatedAt };
};

/**
 * Subscribes to the rider-position broadcast on the `order-<id>` topic and
 * pushes each new position to `onPosition`. This is the ONLY subscriber to
 * that topic on the customer client (useCustomerOrder uses its own
 * `customer-order:<id>` postgres_changes channel), so there is no
 * same-topic double-subscribe.
 *
 * Live push only - no fallback poll of its own. The order-detail poll in
 * useCustomerOrder already refreshes the rider's last-known coordinates on its
 * own cadence, so a dropped socket degrades to that, not to a dead marker.
 * `onPosition` is read through a ref so the effect does not resubscribe when
 * the caller passes a fresh closure each render.
 */
export const useRiderPositionRealtime = (
  orderId: string | null,
  onPosition: (position: RiderPosition) => void
) => {
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;

  useEffect(() => {
    if (!orderId) {
      return;
    }

    const channel = supabase
      .channel(orderRealtimeTopic(orderId))
      .on('broadcast', { event: RIDER_POSITION_EVENT }, (message) => {
        const position = readPosition((message as { payload?: unknown }).payload);
        if (position) {
          onPositionRef.current(position);
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orderId]);
};
