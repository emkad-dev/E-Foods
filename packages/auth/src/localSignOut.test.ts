/**
 * Run with: node --test --experimental-strip-types packages/auth/src/localSignOut.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestEffortWithin, hasStoredSession, signOutThisDevice } from './localSignOut.ts';

const KEY = 'sb-abcdefgh-auth-token';

// Mirrors the two protected fields of GoTrueClient the helper reads: the
// client's own storage and the storage key it derived from the project URL.
const fakeClient = (signOut: (options?: unknown) => Promise<{ error: unknown }>, stored = true) => {
  const store = new Map<string, string>(stored ? [[KEY, '{"refresh_token":"r"}']] : []);
  const calls: unknown[] = [];
  const client = {
    storageKey: KEY,
    storage: {
      getItem: async (k: string) => store.get(k) ?? null,
      removeItem: async (k: string) => void store.delete(k),
    },
    auth: undefined as unknown,
  } as any;
  client.auth = {
    storageKey: KEY,
    storage: client.storage,
    signOut: (options?: unknown) => {
      calls.push(options);
      return signOut(options);
    },
  };
  return { supabase: client as any, store, calls };
};

test('online sign-out goes to the server with local scope and leaves storage to auth-js', async () => {
  const { supabase, store, calls } = fakeClient(async () => ({ error: null }));
  assert.equal(await signOutThisDevice(supabase), 'server');
  assert.deepEqual(calls, [{ scope: 'local' }]);
  // auth-js removes it itself on success; the helper must not have to.
  assert.equal(store.has(KEY), true);
});

test('a network failure still ends signed out on this device', async () => {
  const { supabase, store } = fakeClient(async () => ({
    error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 },
  }));
  assert.equal(await signOutThisDevice(supabase), 'local-only');
  assert.equal(store.has(KEY), false);
});

test('a rejected sign-out call is handled the same way', async () => {
  const { supabase, store } = fakeClient(async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(await signOutThisDevice(supabase), 'local-only');
  assert.equal(store.has(KEY), false);
});

test('a sign-out that hangs past the bound is abandoned and the session removed locally', async () => {
  const { supabase, store } = fakeClient(() => new Promise(() => undefined));
  const started = Date.now();
  assert.equal(await signOutThisDevice(supabase, { timeoutMs: 30 }), 'local-only');
  assert.ok(Date.now() - started < 1000);
  assert.equal(store.has(KEY), false);
});

test('a dead refresh token (server says no) also ends signed out', async () => {
  const { supabase, store } = fakeClient(async () => ({
    error: { name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 },
  }));
  assert.equal(await signOutThisDevice(supabase), 'local-only');
  assert.equal(store.has(KEY), false);
});

test('a client whose storage cannot be reached still resolves without throwing', async () => {
  const supabase = { auth: { signOut: async () => ({ error: new Error('x') }) } } as any;
  assert.equal(await signOutThisDevice(supabase), 'local-only');
});

test('hasStoredSession reads the stored session from the client own storage', async () => {
  const present = fakeClient(async () => ({ error: null }), true);
  const absent = fakeClient(async () => ({ error: null }), false);
  assert.equal(await hasStoredSession(present.supabase), true);
  assert.equal(await hasStoredSession(absent.supabase), false);
  assert.equal(await hasStoredSession({ auth: {} } as any), false);
});

test('bestEffortWithin resolves with the work, or gives up quietly at the bound', async () => {
  assert.equal(await bestEffortWithin(async () => 7, 1000), 7);
  assert.equal(await bestEffortWithin(() => new Promise(() => undefined), 20), undefined);
  assert.equal(
    await bestEffortWithin(async () => {
      throw new Error('boom');
    }, 1000),
    undefined
  );
});
