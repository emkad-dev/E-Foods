import { Platform } from 'react-native';

let isInitialized = false;
let initializationPromise: Promise<boolean> | null = null;

const DEFAULT_SENTRY_DSN =
  'https://4a5c3f8b1f0482ab71bec0788114e027@o4511625693102080.ingest.de.sentry.io/4511625718464592';

const readTrimmedEnv = (name: string) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
};

export const initializeSentry = async (appName: string) => {
  if (isInitialized) {
    return false;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  const dsn = readTrimmedEnv('EXPO_PUBLIC_SENTRY_DSN') || DEFAULT_SENTRY_DSN;
  if (!dsn) {
    return false;
  }

  const environment = readTrimmedEnv('EXPO_PUBLIC_APP_ENV') || (__DEV__ ? 'development' : 'production');

  initializationPromise = (async () => {
    try {
      if (Platform.OS === 'web') {
        const Sentry = await import('@sentry/browser');

        Sentry.init({
          dsn,
          environment,
          sendDefaultPii: false,
          tracesSampleRate: __DEV__ ? 1 : 0.1,
        });
        Sentry.setTag('app', appName);
        isInitialized = true;
        return true;
      }

      const Sentry = await import('@sentry/react-native');

      Sentry.init({
        dsn,
        enableLogs: __DEV__,
        environment,
        profilesSampleRate: __DEV__ ? 1 : 0.1,
        sendDefaultPii: false,
        tracesSampleRate: __DEV__ ? 1 : 0.1,
      });
      Sentry.setTag('app', appName);
      isInitialized = true;
      return true;
    } catch (error) {
      console.warn(`Failed to initialize Sentry for ${appName}:`, error);
      return false;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
};

export const wrapWithSentry = <T>(component: T) => component;
