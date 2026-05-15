import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { appEnv } from '../config/env';
import { useAuth } from '../contexts/AuthContext';
import { updateUserDocument } from '../services/supabase/profile';

const isExpoGo = Constants.executionEnvironment === 'storeClient';

type NotificationData = {
  orderId?: string;
  path?: string;
  type?: string;
};

const routeFromNotification = (data: NotificationData) => {
  if (typeof data.path === 'string' && data.path.trim()) {
    router.push(data.path as never);
    return;
  }

  if (data.type === 'order_update' && data.orderId) {
    router.push(`/order/${data.orderId}`);
  }
};

export const usePushNotifications = () => {
  const { user } = useAuth();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const registeredUserId = useRef<string | null>(null);

  useEffect(() => {
    if (isExpoGo || Platform.OS === 'web') {
      return;
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    const registerForPushNotifications = async () => {
      if (!user || registeredUserId.current === user.uid) {
        return;
      }

      try {
        if (!Device.isDevice) {
          console.warn('Push notifications require a physical device.');
          return;
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        const { status: finalStatus } =
          existingStatus === 'granted'
            ? { status: existingStatus }
            : await Notifications.requestPermissionsAsync();

        if (finalStatus !== 'granted') {
          console.warn('Push notification permission was not granted.');
          return;
        }

        const projectId = appEnv.projectId;
        if (!projectId) {
          console.error('EXPO project id is missing. Push registration skipped.');
          return;
        }

        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        await updateUserDocument(user.uid, {
          expoPushToken: token,
          pushTokenUpdatedAt: new Date().toISOString(),
        });
        registeredUserId.current = user.uid;

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            lightColor: '#C87D22',
            vibrationPattern: [0, 250, 250, 250],
          });
        }
      } catch (error) {
        console.error('Push registration failed.', error);
      }
    };

    if (user) {
      void registerForPushNotifications();
    } else {
      registeredUserId.current = null;
    }

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {});
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      routeFromNotification((response.notification.request.content.data ?? {}) as NotificationData);
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [user]);
};
