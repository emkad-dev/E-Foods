/**
 * Run with: node --test --experimental-strip-types packages/auth/src/sessionLock.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withExecutionTimeout } from './sessionLock.ts';

test('resolves with the value when fn finishes before the timeout', async () => {
  const result = await withExecutionTimeout(() => Promise.resolve('ok'), 50, 'test');
  assert.equal(result, 'ok');
});

test("rejects with fn's own error when fn rejects before the timeout", async () => {
  await assert.rejects(
    () => withExecutionTimeout(() => Promise.reject(new Error('boom')), 50, 'test'),
    /boom/
  );
});

test('rejects with a labelled timeout error when fn never settles', async () => {
  await assert.rejects(
    () => withExecutionTimeout(() => new Promise(() => {}), 20, 'test-lock'),
    /test-lock did not resolve within 20ms/
  );
});

test('a late resolution after the timeout already fired does not crash or reject again', async () => {
  let resolveLate: (value: string) => void = () => {};
  const latePromise = new Promise<string>((resolve) => {
    resolveLate = resolve;
  });

  const racing = withExecutionTimeout(() => latePromise, 10, 'test');
  await assert.rejects(() => racing, /did not resolve within 10ms/);

  resolveLate('too late');
  // Give the orphaned promise a tick to settle; nothing should observe or throw.
  await new Promise((resolve) => setTimeout(resolve, 20));
});
