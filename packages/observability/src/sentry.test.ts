import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureAppErrorPayload,
  createSentryInitializer,
  installGlobalErrorHandlers,
  isWebRuntime,
  reportError,
  resetSentryStateForTest,
} from './sentry.ts';

type MutableGlobal = typeof globalThis & { ErrorUtils?: unknown; window?: unknown };

/**
 * Installs `window`/`ErrorUtils` on globalThis for one test and restores
 * whatever was there before — including the "was not defined at all" case,
 * which `delete` (not assigning undefined) is what reproduces.
 */
const withGlobals = (globals: { ErrorUtils?: unknown; window?: unknown }, run: () => void) => {
  const scope = globalThis as MutableGlobal;
  const hadWindow = 'window' in scope;
  const hadErrorUtils = 'ErrorUtils' in scope;
  const previousWindow = scope.window;
  const previousErrorUtils = scope.ErrorUtils;

  if ('window' in globals) {
    scope.window = globals.window;
  }

  if ('ErrorUtils' in globals) {
    scope.ErrorUtils = globals.ErrorUtils;
  }

  try {
    run();
  } finally {
    if (hadWindow) {
      scope.window = previousWindow;
    } else {
      delete scope.window;
    }

    if (hadErrorUtils) {
      scope.ErrorUtils = previousErrorUtils;
    } else {
      delete scope.ErrorUtils;
    }
  }
};

/**
 * React Native's setUpGlobals.js does `global.window = global`, so `window`
 * exists on native but has no DOM `document` and no `addEventListener`.
 */
const reactNativeWindow = () => globalThis;

const fakeDomWindow = () => {
  const listeners: Array<[string, (event: never) => void]> = [];
  const removed: string[] = [];

  return {
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.push([type, listener]);
    },
    document: {},
    listeners,
    removeEventListener: (type: string) => {
      removed.push(type);
    },
    removed,
  };
};

test('captureAppErrorPayload normalizes the source and error shape', () => {
  const payload = captureAppErrorPayload('admin-web', 'window.error', 'boom', {
    requestId: 'req-1',
  });

  assert.equal(payload.appName, 'admin-web');
  assert.equal(payload.error.message, 'boom');
  assert.deepEqual(payload.extra, {
    requestId: 'req-1',
    source: 'window.error',
  });
  assert.deepEqual(payload.tags, {
    app: 'admin-web',
    source: 'window.error',
  });
});

test('createSentryInitializer is idempotent and installs handlers once', async () => {
  resetSentryStateForTest();

  const initCalls: Array<Record<string, unknown>> = [];
  const tagCalls: Array<[string, string]> = [];
  const captured: Array<{ message: string; context?: { extra?: Record<string, unknown>; tags?: Record<string, unknown> } }> = [];
  let handlerInstalls = 0;

  const initializer = createSentryInitializer({
    getDsn: () => 'https://example.invalid/1',
    getEnvironment: () => 'test',
    getPlatform: () => 'web',
    installHandlers: (capture, appName) => {
      handlerInstalls += 1;
      capture(new Error('synthetic'), { extra: { appName, source: 'test' }, tags: { app: appName } });
      return () => undefined;
    },
    loadNativeSdk: async () => ({
      captureException: (error, context) => {
        captured.push({ message: error.message, context });
      },
      init: (options) => {
        initCalls.push(options);
      },
      setTag: (key, value) => {
        tagCalls.push([key, value]);
      },
    }),
    loadWebSdk: async () => ({
      captureException: (error, context) => {
        captured.push({ message: error.message, context });
      },
      init: (options) => {
        initCalls.push(options);
      },
      setTag: (key, value) => {
        tagCalls.push([key, value]);
      },
    }),
  });

  const first = await initializer('admin-web');
  const second = await initializer('admin-web');

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(initCalls.length, 1);
  assert.equal(handlerInstalls, 1);
  assert.deepEqual(tagCalls, [['app', 'admin-web']]);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].message, 'synthetic');
});

test('createSentryInitializer returns false when the DSN is missing', async () => {
  resetSentryStateForTest();

  const initializer = createSentryInitializer({
    getDsn: () => '',
    loadNativeSdk: async () => {
      throw new Error('should not load native sdk');
    },
    loadWebSdk: async () => {
      throw new Error('should not load web sdk');
    },
  });

  const result = await initializer('customer');
  assert.equal(result, false);
});

test('installGlobalErrorHandlers uses ErrorUtils on React Native, where window exists but addEventListener does not', () => {
  resetSentryStateForTest();

  let installedHandler: ((error: unknown, isFatal?: boolean) => void) | null = null;
  const previousHandler = () => undefined;
  const captured: Array<{ message: string; source: unknown }> = [];

  withGlobals(
    {
      ErrorUtils: {
        getGlobalHandler: () => previousHandler,
        setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => {
          installedHandler = handler;
        },
      },
      window: reactNativeWindow(),
    },
    () => {
      assert.equal(isWebRuntime(), false);

      // The bug this guards: the old `typeof window !== 'undefined'` check
      // sent native down the DOM branch and threw here.
      const cleanup = installGlobalErrorHandlers((error, context) => {
        captured.push({
          message: (error as Error).message,
          source: (context as { extra?: { source?: unknown } } | undefined)?.extra?.source,
        });
      }, 'customer');

      assert.equal(typeof installedHandler, 'function');
      installedHandler?.(new Error('native boom'), true);
      assert.deepEqual(captured, [{ message: 'native boom', source: 'react-native.global' }]);

      cleanup();
    }
  );

  resetSentryStateForTest();
});

test('reportError is a safe no-op before initialization', () => {
  // `isDevelopment` is captured once at module load from `globalThis.__DEV__`
  // (see the top of sentry.ts), so it cannot be toggled per test from here --
  // this only asserts the no-op itself: nothing thrown, nothing forwarded.
  resetSentryStateForTest();

  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    // Must not throw, and must not need a try/catch at the call site.
    reportError('checkout', new Error('boom'), { orderId: 'o-1' });
    // Whatever warnings.length is, it must be at most one -- a no-op never
    // does more than warn once, and only in dev.
    assert.ok(warnings.length <= 1);
  } finally {
    console.warn = originalWarn;
    resetSentryStateForTest();
  }
});

test('reportError forwards to the loaded SDK once Sentry has initialized', async () => {
  resetSentryStateForTest();

  const captured: Array<{ message: string; context: { extra?: Record<string, unknown>; tags?: Record<string, unknown> } }> = [];

  const initializer = createSentryInitializer({
    getDsn: () => 'https://example.invalid/1',
    getEnvironment: () => 'test',
    getPlatform: () => 'web',
    installHandlers: () => () => undefined,
    loadWebSdk: async () => ({
      captureException: (error, context) => {
        captured.push({ message: error.message, context });
      },
      init: () => undefined,
      setTag: () => undefined,
    }),
  });

  await initializer('customer');

  reportError('checkout', new Error('payment failed'), { orderId: 'o-1' });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].message, 'payment failed');
  assert.deepEqual(captured[0].context.extra, { orderId: 'o-1', source: 'checkout' });
  assert.deepEqual(captured[0].context.tags, { app: 'customer', source: 'checkout' });

  resetSentryStateForTest();
});

test('reportError never throws, even if the SDK it forwards to does', async () => {
  resetSentryStateForTest();

  const initializer = createSentryInitializer({
    getDsn: () => 'https://example.invalid/1',
    getEnvironment: () => 'test',
    getPlatform: () => 'web',
    installHandlers: () => () => undefined,
    loadWebSdk: async () => ({
      captureException: () => {
        throw new Error('Sentry SDK is down');
      },
      init: () => undefined,
      setTag: () => undefined,
    }),
  });

  await initializer('customer');

  assert.doesNotThrow(() => reportError('checkout', new Error('payment failed')));

  resetSentryStateForTest();
});

test('installGlobalErrorHandlers still binds DOM listeners on web and leaves ErrorUtils alone', () => {
  resetSentryStateForTest();

  const domWindow = fakeDomWindow();
  let errorUtilsTouched = false;

  withGlobals(
    {
      ErrorUtils: {
        getGlobalHandler: () => null,
        setGlobalHandler: () => {
          errorUtilsTouched = true;
        },
      },
      window: domWindow,
    },
    () => {
      assert.equal(isWebRuntime(), true);

      const cleanup = installGlobalErrorHandlers(() => undefined, 'customer');

      assert.deepEqual(
        domWindow.listeners.map(([type]) => type),
        ['error', 'unhandledrejection']
      );
      assert.equal(errorUtilsTouched, false);

      cleanup();
      assert.deepEqual(domWindow.removed, ['error', 'unhandledrejection']);
    }
  );

  resetSentryStateForTest();
});
