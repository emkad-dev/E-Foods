type JsonObject = Record<string, unknown>;

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

type GlobalErrorUtils = {
  getGlobalHandler?: () => GlobalErrorHandler | null;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

type SentryCapture = (...args: any[]) => void;

type SentrySdk = {
  captureException: SentryCapture;
  init: (options: JsonObject) => void;
  setTag: (key: string, value: string) => void;
};

type SentryInitializerDeps = {
  getEnvironment: () => string;
  getDsn: () => string;
  getPlatform: () => 'web' | 'native';
  installHandlers: typeof installGlobalErrorHandlers;
  loadNativeSdk?: () => Promise<SentrySdk>;
  loadWebSdk?: () => Promise<SentrySdk>;
};

let isInitialized = false;
let initializationPromise: Promise<boolean> | null = null;
let cleanupGlobalHandlers: (() => void) | null = null;

const DEFAULT_SENTRY_DSN =
  'https://4a5c3f8b1f0482ab71bec0788114e027@o4511625693102080.ingest.de.sentry.io/4511625718464592';

const isDevelopment = Boolean((globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__);

const readTrimmedEnv = (name: string) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
};

const toError = (value: unknown) => {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    return new Error(value.trim());
  }

  if (value && typeof value === 'object' && 'message' in value && typeof (value as { message?: unknown }).message === 'string') {
    return new Error((value as { message: string }).message);
  }

  return new Error('Unknown error');
};

const buildCaptureContext = (
  appName: string,
  source: string,
  extra: JsonObject = {}
): { extra: JsonObject; tags: JsonObject } => ({
  extra: {
    ...extra,
    source,
  },
  tags: {
    app: appName,
    source,
  },
});

export const captureAppErrorPayload = (
  appName: string,
  source: string,
  error: unknown,
  extra: JsonObject = {}
) => ({
  appName,
  error: toError(error),
  ...buildCaptureContext(appName, source, extra),
});

export const installGlobalErrorHandlers = (
  capture: SentryCapture,
  appName: string
) => {
  if (cleanupGlobalHandlers) {
    return cleanupGlobalHandlers;
  }

  const globalScope = globalThis as typeof globalThis & {
    ErrorUtils?: GlobalErrorUtils;
    window?: Window;
  };

  const restoreWindowListeners: Array<() => void> = [];

  if (typeof globalScope.window !== 'undefined') {
    const onError = (event: ErrorEvent) => {
      const payload = captureAppErrorPayload(appName, 'window.error', event.error ?? event.message, {
        filename: event.filename || null,
        lineno: event.lineno || null,
        colno: event.colno || null,
      });
      capture(payload.error, payload);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const payload = captureAppErrorPayload(appName, 'window.unhandledrejection', event.reason);
      capture(payload.error, payload);
    };

    globalScope.window.addEventListener('error', onError);
    globalScope.window.addEventListener('unhandledrejection', onUnhandledRejection);
    restoreWindowListeners.push(() => globalScope.window?.removeEventListener('error', onError));
    restoreWindowListeners.push(() =>
      globalScope.window?.removeEventListener('unhandledrejection', onUnhandledRejection)
    );
  }

  const errorUtils = globalScope.ErrorUtils;
  let previousHandler: GlobalErrorHandler | null = null;

  if (!globalScope.window && errorUtils?.setGlobalHandler) {
    previousHandler = errorUtils.getGlobalHandler?.() ?? null;
    errorUtils.setGlobalHandler((error, isFatal) => {
      const payload = captureAppErrorPayload(appName, 'react-native.global', error, {
        isFatal: Boolean(isFatal),
      });
      capture(payload.error, payload);
      previousHandler?.(error, isFatal);
    });
  }

  cleanupGlobalHandlers = () => {
    for (const cleanup of restoreWindowListeners) {
      cleanup();
    }

    if (errorUtils?.setGlobalHandler && previousHandler) {
      errorUtils.setGlobalHandler(previousHandler);
    }

    cleanupGlobalHandlers = null;
  };

  return cleanupGlobalHandlers;
};

export const createSentryInitializer = (deps: Partial<SentryInitializerDeps> = {}) => {
  const getDsn = deps.getDsn ?? (() => readTrimmedEnv('EXPO_PUBLIC_SENTRY_DSN') || DEFAULT_SENTRY_DSN);
  const loadWebSdk = deps.loadWebSdk ?? (async () => import('@sentry/browser'));
  const loadNativeSdk = deps.loadNativeSdk ?? null;
  const getPlatform = deps.getPlatform ?? (() => (typeof globalThis.window !== 'undefined' ? 'web' : 'native'));
  const getEnvironment = deps.getEnvironment ?? (() => readTrimmedEnv('EXPO_PUBLIC_APP_ENV') || (isDevelopment ? 'development' : 'production'));
  const installHandlers = deps.installHandlers ?? installGlobalErrorHandlers;

  return async (appName: string) => {
    if (isInitialized) {
      return false;
    }

    if (initializationPromise) {
      return initializationPromise;
    }

    const dsn = getDsn();
    if (!dsn) {
      return false;
    }

    const environment = getEnvironment();

    initializationPromise = (async () => {
      try {
        const platform = getPlatform();
        const Sentry = platform === 'web' ? await loadWebSdk() : loadNativeSdk ? await loadNativeSdk() : null;
        if (!Sentry) {
          throw new Error('Native Sentry SDK loader is not configured.');
        }
        const commonOptions: JsonObject = {
          dsn,
          environment,
          sendDefaultPii: false,
          tracesSampleRate: isDevelopment ? 1 : 0.1,
        };

        Sentry.init(
          platform === 'web'
            ? commonOptions
            : {
                ...commonOptions,
                enableLogs: isDevelopment,
                profilesSampleRate: isDevelopment ? 1 : 0.1,
              }
        );
        Sentry.setTag('app', appName);
        installHandlers((error, context) => Sentry.captureException(error, context as never), appName);
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
};

export const initializeSentry = createSentryInitializer();

export const resetSentryStateForTest = () => {
  cleanupGlobalHandlers?.();
  cleanupGlobalHandlers = null;
  isInitialized = false;
  initializationPromise = null;
};

export const wrapWithSentry = <T>(component: T) => component;
