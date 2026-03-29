import { useEffect, useRef } from 'react';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase/config';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const usePushNotifications = () => {
  const { user } = useAuth();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const registrationAttempted = useRef(false);

  useEffect(() => {
    const registerForPushNotifications = async () => {
      if (!user || registrationAttempted.current) return;
      registrationAttempted.current = true;

      try {
        if (!Device.isDevice) {
          alert('Push notifications require a physical device');
          return;
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') {
          console.log('Failed to get push token: permission denied');
          return;
        }

        const projectId = Constants.expoConfig?.extra?.EXPO_PUBLIC_PROJECT_ID;
        if (!projectId) {
          console.error('Project ID not found in app config');
          return;
        }

        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

        await updateDoc(doc(db, 'users', user.uid), {
          expoPushToken: token,
          pushTokenUpdatedAt: new Date().toISOString(),
        });

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
          });
        }
      } catch (error) {
        console.error('Error registering push notifications:', error);
      }
    };

    if (user) {
      void registerForPushNotifications();
    }

    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const { data } = response.notification.request.content;
      if (data?.type === 'order_update' && data?.orderId) {
        router.push(`/orders/${data.orderId}`);
      } else if (data?.type === 'promotion') {
        router.push('/promotions');
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [user]);
};
