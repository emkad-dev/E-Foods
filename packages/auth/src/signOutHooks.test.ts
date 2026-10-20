/**
 * Run with: node --test --experimental-strip-types packages/auth/src/signOutHooks.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerBeforeSignOut, runBeforeSignOutHooks } from './signOutHooks.ts';

test('hooks run before sign-out and can be unregistered', async () => {
  const calls: string[] = [];
  const unregister = registerBeforeSignOut(async () => {
    calls.push('push-token-cleared');
  });
  await runBeforeSignOutHooks();
  unregister();
  await runBeforeSignOutHooks();
  assert.deepEqual(calls, ['push-token-cleared']);
});

test('a failing hook never blocks sign-out', async () => {
  const unregister = registerBeforeSignOut(async () => {
    throw new Error('network down');
  });
  await runBeforeSignOutHooks();
  unregister();
});

test('a hanging hook is abandoned after the timeout', async () => {
  const unregister = registerBeforeSignOut(() => new Promise<void>(() => undefined));
  const started = Date.now();
  await runBeforeSignOutHooks(50);
  unregister();
  assert.ok(Date.now() - started < 1_000);
});
