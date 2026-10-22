/**
 * Run with: node --test --experimental-strip-types packages/auth/src/singleDeviceSession.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSingleDeviceSessionDecision } from './singleDeviceSession.ts';

test('fresh sign-in whose claim has landed stays put (local === remote)', () => {
  assert.deepEqual(
    resolveSingleDeviceSessionDecision({
      localSessionId: 'device-A',
      remoteSessionId: 'device-A',
      enforceSingleDevice: true,
    }),
    { type: 'ok' }
  );
});

test('same-device refresh never forces re-login', () => {
  // The forced-re-login regression: a plain reload must not evict when the
  // device still matches the remote id.
  assert.deepEqual(
    resolveSingleDeviceSessionDecision({
      localSessionId: 'device-A',
      remoteSessionId: 'device-A',
      enforceSingleDevice: true,
    }),
    { type: 'ok' }
  );
});

test('a real second-device takeover evicts the first device on its next reconcile', () => {
  assert.deepEqual(
    resolveSingleDeviceSessionDecision({
      localSessionId: 'device-A',
      remoteSessionId: 'device-B',
      enforceSingleDevice: true,
    }),
    { type: 'evict' }
  );
});

test('a missing remote activeSessionId never evicts', () => {
  assert.deepEqual(
    resolveSingleDeviceSessionDecision({
      localSessionId: 'device-A',
      remoteSessionId: null,
      enforceSingleDevice: true,
    }),
    { type: 'ok' }
  );
});

test('a brand-new signup (no remote, no local) never evicts', () => {
  assert.deepEqual(
    resolveSingleDeviceSessionDecision({
      localSessionId: null,
      remoteSessionId: null,
      enforceSingleDevice: true,
    }),
    { type: 'ok' }
  );
});

test('first sight on a fresh install adopts the remote id instead of evicting', () => {
  assert.deepEqual(
    resolveSingleDeviceSessionDecision({
      localSessionId: null,
      remoteSessionId: 'device-A',
      enforceSingleDevice: true,
    }),
    { type: 'adopt', sessionId: 'device-A' }
  );
});

test('partner is multi-device: a different remote id never evicts', () => {
  // Partner device A stays signed in after partner device B signs in and
  // overwrites activeSessionId.
  assert.deepEqual(
    resolveSingleDeviceSessionDecision({
      localSessionId: 'device-A',
      remoteSessionId: 'device-B',
      enforceSingleDevice: false,
    }),
    { type: 'ok' }
  );
});

test('partner never adopts a single session id even on first sight', () => {
  assert.deepEqual(
    resolveSingleDeviceSessionDecision({
      localSessionId: null,
      remoteSessionId: 'device-B',
      enforceSingleDevice: false,
    }),
    { type: 'ok' }
  );
});
