/**
 * Run with: node --test --experimental-strip-types packages/auth/src/foregroundSessionCheck.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createForegroundSessionCheck, shouldCheckSessionOnForeground } from './foregroundSessionCheck.ts';

const SESSION = { access_token: 'token' };

const ready = {
  previousState: 'background',
  nextState: 'active',
  isOffline: true,
  isSignInInProgress: false,
  isCheckInFlight: false,
};

test('the check runs when an offline app comes back to the foreground', () => {
  assert.equal(shouldCheckSessionOnForeground(ready), true);
  assert.equal(shouldCheckSessionOnForeground({ ...ready, previousState: 'inactive' }), true);
  // iOS can report this before the first change event.
  assert.equal(shouldCheckSessionOnForeground({ ...ready, previousState: 'unknown' }), true);
});

test('the normal case does nothing, so it adds no invocations', () => {
  assert.equal(shouldCheckSessionOnForeground({ ...ready, isOffline: false }), false);
});

test('a sign-in owns its own transition', () => {
  assert.equal(shouldCheckSessionOnForeground({ ...ready, isSignInInProgress: true }), false);
});

test('only a transition to active counts', () => {
  assert.equal(shouldCheckSessionOnForeground({ ...ready, previousState: 'active' }), false);
  assert.equal(shouldCheckSessionOnForeground({ ...ready, nextState: 'background' }), false);
  assert.equal(shouldCheckSessionOnForeground({ ...ready, nextState: 'inactive' }), false);
});

test('a check still waiting on the network is not started twice', () => {
  assert.equal(shouldCheckSessionOnForeground({ ...ready, isCheckInFlight: true }), false);
});

const harness = (overrides: Partial<Parameters<typeof createForegroundSessionCheck<typeof SESSION>>[0]> = {}) => {
  const queued: unknown[] = [];
  const counts = { getSession: 0 };
  const check = createForegroundSessionCheck<typeof SESSION>({
    initialState: 'active',
    getSession: async () => {
      counts.getSession += 1;
      return { data: { session: SESSION } };
    },
    isOffline: () => true,
    isSignInInProgress: () => false,
    queueReconcile: (session) => queued.push(session),
    ...overrides,
  });
  return { check, queued, counts };
};

test('coming back offline with a session queues exactly one reconcile', async () => {
  const { check, queued, counts } = harness();
  await check.onAppStateChange('background');
  assert.equal(counts.getSession, 0);
  await check.onAppStateChange('active');
  assert.deepEqual(queued, [SESSION]);
  assert.equal(counts.getSession, 1);
});

test('no session means nothing to reconcile', async () => {
  const { check, queued } = harness({ getSession: async () => ({ data: { session: null } }) });
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  assert.deepEqual(queued, []);
});

test('when not offline it does not even ask for the session', async () => {
  const { check, queued, counts } = harness({ isOffline: () => false });
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  assert.equal(counts.getSession, 0);
  assert.deepEqual(queued, []);
});

test('while a sign-in holds the guard it does not even ask for the session', async () => {
  const { check, queued, counts } = harness({ isSignInInProgress: () => true });
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  assert.equal(counts.getSession, 0);
  assert.deepEqual(queued, []);
});

test('each transition gets its own check, and repeat active reports get none', async () => {
  const { check, queued } = harness();
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  await check.onAppStateChange('active');
  assert.equal(queued.length, 1);
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  assert.equal(queued.length, 2);
});

test('a quick background and back while the first check waits adds no second one', async () => {
  let release!: (value: { data: { session: typeof SESSION } }) => void;
  const { check, queued, counts } = harness({
    getSession: () => {
      counts.getSession += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await check.onAppStateChange('background');
  const first = check.onAppStateChange('active');
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  release({ data: { session: SESSION } });
  await first;
  assert.equal(counts.getSession, 1);
  assert.equal(queued.length, 1);
});

// getSession refreshing an expired token (or, on web, auth-js's own visibility
// listener) emits an event whose listener already queues the reconcile.
test('an auth event during the check already reconciled, so no second one is queued', async () => {
  const holder: { check?: ReturnType<typeof createForegroundSessionCheck> } = {};
  const { check, queued } = harness({
    getSession: async () => {
      holder.check?.noteAuthEvent();
      return { data: { session: SESSION } };
    },
  });
  holder.check = check as never;
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  assert.deepEqual(queued, []);
});

test('an auth event before the check does not suppress it', async () => {
  const { check, queued } = harness();
  check.noteAuthEvent();
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  assert.deepEqual(queued, [SESSION]);
});

test('a sign-in or sign-out that starts during the check wins', async () => {
  let signingIn = false;
  const signIn = harness({
    isSignInInProgress: () => signingIn,
    getSession: async () => {
      signingIn = true;
      return { data: { session: SESSION } };
    },
  });
  await signIn.check.onAppStateChange('background');
  await signIn.check.onAppStateChange('active');
  assert.deepEqual(signIn.queued, []);

  // Signing out clears the no-internet error, which ends the offline state.
  let offline = true;
  const signOut = harness({
    isOffline: () => offline,
    getSession: async () => {
      offline = false;
      return { data: { session: SESSION } };
    },
  });
  await signOut.check.onAppStateChange('background');
  await signOut.check.onAppStateChange('active');
  assert.deepEqual(signOut.queued, []);
});

test('a failed check is quiet, and the next transition tries again', async () => {
  let attempts = 0;
  const { check, queued } = harness({
    getSession: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('auth lock timed out');
      }
      return { data: { session: SESSION } };
    },
  });
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  assert.deepEqual(queued, []);
  await check.onAppStateChange('background');
  await check.onAppStateChange('active');
  assert.deepEqual(queued, [SESSION]);
});
