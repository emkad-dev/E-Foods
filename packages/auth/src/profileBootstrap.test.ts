/**
 * Run with: node --test --experimental-strip-types packages/auth/src/profileBootstrap.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackendRpcError } from './backendRpc.ts';
import { fetchProfileBootstrap } from './profileBootstrap.ts';

const ROW = {
  uid: 'u1',
  email: 'rider@example.com',
  role: 'customer',
  emailVerified: true,
  dispatchApplicationStatus: 'pending',
  activeSessionId: 'device-1',
};

const callReturning = (outcomes: Array<() => unknown>) => {
  const actions: string[] = [];
  const call = async <T>(action: string): Promise<T> => {
    actions.push(action);
    const outcome = outcomes[Math.min(actions.length - 1, outcomes.length - 1)];
    return outcome() as T;
  };
  return { call, actions };
};

test('maps the returned row through the same mapper as the direct profile read', async () => {
  const { call, actions } = callReturning([() => ({ profile: ROW })]);

  const result = await fetchProfileBootstrap(call, 'dispatchBootstrap');

  assert.deepEqual(actions, ['dispatchBootstrap']);
  assert.equal(result?.profile?.uid, 'u1');
  assert.equal(result?.profile?.emailVerified, true);
  assert.equal(result?.profile?.dispatchApplicationStatus, 'pending');
  // The mapper fills the shape the app expects, not the raw row.
  assert.equal(result?.profile?.activeSessionId, 'device-1');
  assert.equal(result?.profile?.accountDisabled, false);
  assert.equal(result?.profile?.partnerPayout, null);
});

test('an account with no profile row yet is a bootstrap with a null profile, not an unavailable one', async () => {
  const { call } = callReturning([() => ({ profile: null })]);

  assert.deepEqual(await fetchProfileBootstrap(call, 'partnerBootstrap'), { profile: null });
});

test('falls back (null) when the deployed backend does not implement the action', async () => {
  for (const status of [501, 404]) {
    const { call, actions } = callReturning([
      () => {
        throw new BackendRpcError('not implemented', { status });
      },
    ]);

    assert.equal(await fetchProfileBootstrap(call, 'partnerBootstrap'), null, `HTTP ${status}`);
    // An answer is not retried.
    assert.equal(actions.length, 1);
  }
});

test('retries the read once after a transient network failure', async () => {
  const { call, actions } = callReturning([
    () => {
      throw new TypeError('Network request failed');
    },
    () => ({ profile: ROW }),
  ]);

  const result = await fetchProfileBootstrap(call, 'dispatchBootstrap');

  assert.equal(result?.profile?.uid, 'u1');
  assert.deepEqual(actions, ['dispatchBootstrap', 'dispatchBootstrap']);
});

test('a real server error propagates after one attempt rather than reading as "not deployed"', async () => {
  const { call, actions } = callReturning([
    () => {
      throw new BackendRpcError('boom', { status: 500 });
    },
  ]);

  await assert.rejects(() => fetchProfileBootstrap(call, 'dispatchBootstrap'), /boom/);
  assert.equal(actions.length, 1);
});
