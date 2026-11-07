import assert from 'node:assert/strict';
import test from 'node:test';

import { flushPendingPolicyAcceptance } from './pendingPolicyAcceptance.ts';

const setup = (overrides: { pending?: string | null; current?: boolean; recordFails?: boolean } = {}) => {
  const calls = { record: 0, clear: 0 };
  return {
    calls,
    run: (userId: string) =>
      flushPendingPolicyAcceptance({
        userId,
        readPendingUserId: async () => (overrides.pending === undefined ? 'user-a' : overrides.pending),
        isStillCurrent: async () => overrides.current ?? true,
        record: async () => {
          calls.record += 1;
          if (overrides.recordFails) {
            throw new Error('network');
          }
        },
        clearPending: async () => {
          calls.clear += 1;
        },
      }),
  };
};

test('the account that accepted at sign-up gets it recorded, once, and the entry is cleared', async () => {
  const { calls, run } = setup();
  assert.equal(await run('user-a'), 'recorded');
  assert.deepEqual(calls, { record: 1, clear: 1 });
});

test('another account never gets consent recorded, and the entry stays for its owner', async () => {
  const { calls, run } = setup({ pending: 'user-a' });
  assert.equal(await run('user-b'), 'nothing-pending');
  assert.deepEqual(calls, { record: 0, clear: 0 });
});

test('nothing pending records nothing', async () => {
  const { calls, run } = setup({ pending: null });
  assert.equal(await run('user-a'), 'nothing-pending');
  assert.deepEqual(calls, { record: 0, clear: 0 });
});

test('a user who no longer holds the session records nothing and keeps the entry', async () => {
  const { calls, run } = setup({ current: false });
  assert.equal(await run('user-a'), 'stale');
  assert.deepEqual(calls, { record: 0, clear: 0 });
});

test('a failed write keeps the entry so the next sign-in retries it', async () => {
  const { calls, run } = setup({ recordFails: true });
  await assert.rejects(run('user-a'), /network/);
  assert.deepEqual(calls, { record: 1, clear: 0 });
});
