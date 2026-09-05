import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureAppErrorPayload,
  createSentryInitializer,
  resetSentryStateForTest,
} from './sentry.ts';

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
