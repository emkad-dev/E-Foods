import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { clearUserPushToken, registerBeforeSignOut } from '../../../../packages/auth/src';
import {
  ANDROID_NOTIFICATION_CHANNELS,
  resolveEasProjectId,
  resolveNotificationHref,
  type AppNotificationPayload,
} from '../../../../packages/domain/src/notifications';
import { appEnv } from '../config/env';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase/config';
import { updateUserDocument } from '../services/supabase/profile';

const isExpoGo = Constants.executionEnvironment === 'storeClient';
const pushSupported = !isExpoGo && Platform.OS !== 'web';

// The token this device registered for the signed-in account. Module scope so
// the before-sign-out hook (registered once) can detach exactly this token.
let currentRegistration: { token: string; uid: string } | null = null;

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  registerBeforeSignOut(async () => {
    const registration = currentRegistration;
    currentRegistration = null;
    if (registration) {
      await clearUserPushToken(supabase, registration.uid, registration.token);
    }
  });
}

/**
 * Channels must exist BEFORE the permission prompt and before any push
 * arrives: on Android 13+ the POST_NOTIFICATIONS prompt is only shown once a
 * channel exists, and a push naming a channel the device does not have is
 * silently dropped.
 */
const ensureAndroidChannels = async () => {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNELS.default, {
    name: 'Order alerts',
    importance: Notifications.AndroidImportance.MAX,
    lightColor: '#F57C00',
    vibrationPattern: [0, 250, 250, 250],
  });
};

const registerDeviceForUser = async (uid: string) => {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device.');
    return false;
  }

  await ensureAndroidChannels();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  const { status: finalStatus } =
    existingStatus === 'granted' ? { status: existingStatus } : await Notifications.requestPermissionsAsync();

  if (finalStatus !== 'granted') {
    console.warn('Push notification permission was not granted.');
    return false;
  }

  const projectId = resolveEasProjectId(
    Constants.easConfig?.projectId,
    Constants.expoConfig?.extra?.eas?.projectId,
    appEnv.projectId
  );
  if (!projectId) {
    console.error('No EAS project id (extra.eas.projectId) is configured. Push registration skipped.');
    return false;
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await updateUserDocument(uid, {
    expoPushToken: token,
    pushTokenUpdatedAt: new Date().toISOString(),
  });
  currentRegistration = { token, uid };
  return true;
};

export const usePushNotifications = () => {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const registeredUserId = useRef<string | null>(null);
  const handledResponseIds = useRef<Set<string>>(new Set());

  // Registration: once per signed-in account, again if FCM/APNs rotates the
  // device token (the Expo token is derived from it).
  useEffect(() => {
    if (!pushSupported) {
      return;
    }

    if (!uid) {
      registeredUserId.current = null;
      return;
    }

    let cancelled = false;

    const register = async () => {
      if (registeredUserId.current === uid) {
        return;
      }
      try {
        const registered = await registerDeviceForUser(uid);
        if (registered && !cancelled) {
          registeredUserId.current = uid;
        }
      } catch (error) {
        console.error('Push registration failed.', error);
      }
    };

    void register();

    const tokenSubscription = Notifications.addPushTokenListener(() => {
      registeredUserId.current = null;
      void register();
    });

    return () => {
      cancelled = true;
      tokenSubscription.remove();
    };
  }, [uid]);

  // Taps: routed with the server's routeKey/path, including the tap that
  // cold-started the app.
  useEffect(() => {
    if (!pushSupported) {
      return;
    }

    const handleNotificationResponse = async (response: Notifications.NotificationResponse | null) => {
      if (!response) {
        return;
      }

      const identifier =
        response.notification.request.identifier ||
        JSON.stringify(response.notification.request.content.data ?? {});

      if (handledResponseIds.current.has(identifier)) {
        return;
      }

      handledResponseIds.current.add(identifier);

      const href = resolveNotificationHref(
        'partner',
        (response.notification.request.content.data ?? {}) as AppNotificationPayload
      );

      if (href) {
        setTimeout(() => {
          router.push(href as never);
        }, 50);
      }

      await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationResponse(response);
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => handleNotificationResponse(response))
      .catch((error) => {
        console.warn('Unable to inspect the last partner notification response.', error);
      });

    return () => {
      responseSubscription.remove();
    };
  }, []);
};
