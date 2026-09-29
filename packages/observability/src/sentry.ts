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
// Set once init succeeds; reportError below needs both to tag and route a
// capture, and there is nothing safe to do with either alone.
let activeSdk: SentrySdk | null = null;
let activeAppName: string | null = null;

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

/** The subset of the DOM `window` this module actually touches. */
type WebGlobalScope = {
  addEventListener: (type: string, listener: (event: never) => void) => void;
  document?: unknown;
  removeEventListener: (type: string, listener: (event: never) => void) => void;
};

/**
 * Returns the real DOM window, or null when there isn't one.
 *
 * `typeof window !== 'undefined'` is NOT a web check in React Native:
 * react-native/Libraries/Core/setUpGlobals.js assigns `global.window =
 * global`, so the binding always exists on native. That alias carries
 * neither a DOM `document` nor `addEventListener`, so the old check sent
 * native into the web branch and threw on `window.addEventListener` before
 * the ErrorUtils branch below could ever run.
 *
 * Probing for the APIs this module calls (rather than for the `window`
 * binding) is what makes web/native detection correct on RN, RN Web, Expo
 * web, and Node/jsdom test environments alike — and it is deliberately a
 * single shared helper so the platform choice in createSentryInitializer and
 * the handler choice here can never disagree about which runtime this is.
 */
const resolveWebScope = (): WebGlobalScope | null => {
  // Cast through `unknown`: the DOM lib types `window` as `Window &
  // typeof globalThis`, whose overloaded addEventListener does not overlap
  // structurally with the narrow shape above.
  const candidate = (globalThis as typeof globalThis & { window?: unknown }).window as unknown as
    | Partial<WebGlobalScope>
    | undefined;

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  if (typeof candidate.document === 'undefined') {
    return null;
  }

  if (
    typeof candidate.addEventListener !== 'function' ||
    typeof candidate.removeEventListener !== 'function'
  ) {
    return null;
  }

  return candidate as WebGlobalScope;
};

/** True only in a real DOM environment. See resolveWebScope. */
export const isWebRuntime = () => resolveWebScope() !== null;

export const installGlobalErrorHandlers = (
  capture: SentryCapture,
  appName: string
) => {
  if (cleanupGlobalHandlers) {
    return cleanupGlobalHandlers;
  }

  const globalScope = globalThis as typeof globalThis & {
    ErrorUtils?: GlobalErrorUtils;
  };

  const webScope = resolveWebScope();
  const restoreWindowListeners: Array<() => void> = [];

  if (webScope) {
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

    webScope.addEventListener('error', onError);
    webScope.addEventListener('unhandledrejection', onUnhandledRejection);
    restoreWindowListeners.push(() => webScope.removeEventListener('error', onError));
    restoreWindowListeners.push(() =>
      webScope.removeEventListener('unhandledrejection', onUnhandledRejection)
    );
  }

  const errorUtils = globalScope.ErrorUtils;
  let previousHandler: GlobalErrorHandler | null = null;

  if (!webScope && errorUtils?.setGlobalHandler) {
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
  const getPlatform = deps.getPlatform ?? (() => (isWebRuntime() ? 'web' : 'native'));
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
        activeSdk = Sentry;
        activeAppName = appName;
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
  activeSdk = null;
  activeAppName = null;
};

/**
 * Report a caught error to Sentry from anywhere in the app (not just the
 * global crash handler). Before this, only `installGlobalErrorHandlers`
 * ever called `captureException`, so a `catch` block that handled an error
 * gracefully for the user left the server-side team with nothing.
 *
 * Deliberately forgiving: this runs on error paths, so a reporting failure
 * (SDK not loaded yet, DSN missing in dev, `captureException` itself
 * throwing) must never become the reason the caller's error handling
 * fails. It is a no-op — with a `__DEV__`-only warning so a real miss isn't
 * silent in local testing — whenever `initializeSentry` hasn't completed
 * successfully, including in tests and in any environment with no DSN.
 */
export const reportError = (source: string, error: unknown, extra: Record<string, unknown> = {}): void => {
  if (!activeSdk || !activeAppName) {
    if (isDevelopment) {
      console.warn(`[reportError] Sentry is not initialized; dropping report from "${source}":`, error);
    }
    return;
  }

  try {
    const payload = captureAppErrorPayload(activeAppName, source, error, extra);
    activeSdk.captureException(payload.error, { extra: payload.extra, tags: payload.tags });
  } catch (reportingFailure) {
    if (isDevelopment) {
      console.warn(`[reportError] failed to report error from "${source}":`, reportingFailure);
    }
  }
};

export const wrapWithSentry = <T>(component: T) => component;
