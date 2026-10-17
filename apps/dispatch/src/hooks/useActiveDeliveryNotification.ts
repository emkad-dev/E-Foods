import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { AppNotificationPayload } from '../../../../packages/domain/src/notifications';
import type { DispatchOrder } from './useDispatchOrders';

const NOTIFICATION_ID = 'active-delivery-persistent';

export const useActiveDeliveryNotification = (activeOrders: DispatchOrder[]) => {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const activeOrder = activeOrders[0] ?? null;

    if (activeOrder) {
      const data: AppNotificationPayload = {
        app: 'dispatch',
        orderId: activeOrder.id,
        routeKey: 'dispatch_delivery_detail',
        type: 'active_delivery',
      };

      void Notifications.scheduleNotificationAsync({
        identifier: NOTIFICATION_ID,
        content: {
          title: 'Delivery in progress',
          body: `Order #${activeOrder.id.slice(-6).toUpperCase()} — tap to view`,
          data: data as Record<string, unknown>,
          sticky: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
        },
        trigger: null,
      }).catch(() => undefined);
    } else {
      void Notifications.dismissNotificationAsync(NOTIFICATION_ID).catch(() => undefined);
    }
  }, [activeOrders]);
};
