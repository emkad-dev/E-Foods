/**
 * Run with: node --test --experimental-strip-types packages/auth/src/localSignOut.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestEffortWithin, hasStoredSession, signOutThisDevice } from './localSignOut.ts';

const KEY = 'sb-abcdefgh-auth-token';
const OLD_SESSION = JSON.stringify({ access_token: 'old-token', refresh_token: 'r' });
const NEW_SESSION = JSON.stringify({ access_token: 'new-token', refresh_token: 'r2' });

type AdminSignOut = (jwt: string, scope: string) => Promise<{ data?: null; error: unknown }>;

// Mirrors what the helper reads from GoTrueClient: its own storage, the storage
// key it derived from the project URL, and the lock-free admin logout call.
// `auth.signOut` is present so a test can prove it is never called: that is the
// lock-queued call that reads storage when it finally runs.
const fakeClient = (adminSignOut: AdminSignOut, stored: string | null = OLD_SESSION) => {
  const store = new Map<string, string>(stored ? [[KEY, stored]] : []);
  const adminCalls: Array<[string, string]> = [];
  let storageReads = 0;
  let queuedSignOutCalls = 0;
  const supabase = {
    auth: {
      storageKey: KEY,
      storage: {
        getItem: async (k: string) => {
          storageReads += 1;
          return store.get(k) ?? null;
        },
        removeItem: async (k: string) => void store.delete(k),
      },
      admin: {
        signOut: (jwt: string, scope: string) => {
          adminCalls.push([jwt, scope]);
          return adminSignOut(jwt, scope);
        },
      },
      signOut: async () => {
        queuedSignOutCalls += 1;
        return { error: null };
      },
    },
  } as any;
  return {
    supabase,
    store,
    adminCalls,
    storageReads: () => storageReads,
    queuedSignOutCalls: () => queuedSignOutCalls,
  };
};

const apiError = (status: number, message = 'nope') =>
  Object.assign(new Error(message), { name: 'AuthApiError', status, __isAuthError: true });

test('online sign-out revokes the stored token with local scope, without the lock-queued signOut, and removes it', async () => {
  const { supabase, store, adminCalls, queuedSignOutCalls } = fakeClient(async () => ({ data: null, error: null }));
  assert.equal(await signOutThisDevice(supabase), 'server');
  assert.deepEqual(adminCalls, [['old-token', 'local']]);
  assert.equal(queuedSignOutCalls(), 0);
  assert.equal(store.has(KEY), false);
});

for (const status of [401, 403, 404]) {
  test(`a ${status} means the session is already gone: success, and still removed here`, async () => {
    const { supabase, store } = fakeClient(async () => ({ data: null, error: apiError(status) }));
    assert.equal(await signOutThisDevice(supabase), 'server');
    assert.equal(store.has(KEY), false);
  });
}

// auth-js turns the server's `session_not_found` into this error, with status 400
// (lib/fetch.ts handleError), so the status list above never sees it.
test('a session the server no longer knows about also counts as already gone', async () => {
  const { supabase, store } = fakeClient(async () => ({
    data: null,
    error: Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 }),
  }));
  assert.equal(await signOutThisDevice(supabase), 'server');
  assert.equal(store.has(KEY), false);
});

test('a network failure still ends signed out on this device', async () => {
  const { supabase, store } = fakeClient(async () => ({
    data: null,
    error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 },
  }));
  assert.equal(await signOutThisDevice(supabase), 'local-only');
  assert.equal(store.has(KEY), false);
});

test('a server fault still ends signed out on this device', async () => {
  const { supabase, store } = fakeClient(async () => ({ data: null, error: apiError(500) }));
  assert.equal(await signOutThisDevice(supabase), 'local-only');
  assert.equal(store.has(KEY), false);
});

test('a rejected logout call is handled the same way', async () => {
  const { supabase, store } = fakeClient(async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(await signOutThisDevice(supabase), 'local-only');
  assert.equal(store.has(KEY), false);
});

test('a logout that hangs past the bound is abandoned and the session removed locally', async () => {
  const { supabase, store } = fakeClient(() => new Promise(() => undefined));
  const started = Date.now();
  assert.equal(await signOutThisDevice(supabase, { timeoutMs: 30 }), 'local-only');
  assert.ok(Date.now() - started < 1000);
  assert.equal(store.has(KEY), false);
});

// THE reason this helper does not use auth.signOut: an abandoned one could return
// late, wipe the session stored by the next sign-in, and emit SIGNED_OUT.
for (const [name, settle] of [
  ['succeeds', (resolve: (v: { error: unknown }) => void) => resolve({ error: null })],
  ['says the session is gone', (resolve: (v: { error: unknown }) => void) => resolve({ error: apiError(401) })],
  ['fails', (_resolve: unknown, reject: (e: unknown) => void) => reject(new TypeError('Failed to fetch'))],
] as const) {
  test(`a late logout that ${name} cannot touch a session stored after the removal`, async () => {
    let resolvePost!: (value: { error: unknown }) => void;
    let rejectPost!: (error: unknown) => void;
    const client = fakeClient(
      () =>
        new Promise((resolve, reject) => {
          resolvePost = resolve;
          rejectPost = reject;
        })
    );

    assert.equal(await signOutThisDevice(client.supabase, { timeoutMs: 20 }), 'local-only');
    assert.equal(client.store.has(KEY), false);

    // The user signs straight back in, then the old request finally answers.
    client.store.set(KEY, NEW_SESSION);
    settle(resolvePost, rejectPost);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(client.store.get(KEY), NEW_SESSION);
    // Only ever the old token, read exactly once, so the new one cannot be revoked.
    assert.deepEqual(client.adminCalls, [['old-token', 'local']]);
    assert.equal(client.storageReads(), 1);
    assert.equal(client.queuedSignOutCalls(), 0);
  });
}

test('with nothing stored there is nothing to revoke', async () => {
  const { supabase, adminCalls } = fakeClient(async () => ({ data: null, error: null }), null);
  assert.equal(await signOutThisDevice(supabase), 'local-only');
  assert.deepEqual(adminCalls, []);
});

test('a stored value that cannot be parsed is removed without a server call', async () => {
  const { supabase, store, adminCalls } = fakeClient(async () => ({ data: null, error: null }), 'not json');
  assert.equal(await signOutThisDevice(supabase), 'local-only');
  assert.deepEqual(adminCalls, []);
  assert.equal(store.has(KEY), false);
});

test('a storage read that throws or hangs does not stop the removal', async () => {
  for (const getItem of [
    async () => {
      throw new Error('storage broke');
    },
    () => new Promise<string>(() => undefined),
  ]) {
    const removed: string[] = [];
    const supabase = {
      auth: {
        storageKey: KEY,
        storage: { getItem, removeItem: async (k: string) => void removed.push(k) },
        admin: { signOut: async () => ({ error: null }) },
      },
    } as any;
    assert.equal(await signOutThisDevice(supabase, { timeoutMs: 20 }), 'local-only');
    assert.ok(removed.includes(KEY));
  }
});

test('every key auth-js removes on sign-out is removed', async () => {
  const { supabase, store } = fakeClient(async () => ({ data: null, error: null }));
  store.set(`${KEY}-user`, '{}');
  store.set(`${KEY}-code-verifier`, 'v');
  await signOutThisDevice(supabase);
  assert.deepEqual([...store.keys()], []);
});

test('a client whose storage cannot be reached still resolves without throwing', async () => {
  const supabase = { auth: { admin: { signOut: async () => ({ error: new Error('x') }) } } } as any;
  assert.equal(await signOutThisDevice(supabase), 'local-only');
});

// No SIGNED_OUT fires on this path, and that event is what used to take the
// signed-in user's JWT off the realtime socket. Left there, a guest's public
// channels die when that JWT expires.
test('the realtime socket is moved off the old JWT once the session is gone', async () => {
  const { supabase, store } = fakeClient(async () => ({ data: null, error: null }));
  const seen: Array<{ args: unknown[]; stored: boolean }> = [];
  supabase.realtime = {
    setAuth: async (...args: unknown[]) => {
      seen.push({ args, stored: store.has(KEY) });
    },
  };
  await signOutThisDevice(supabase);
  assert.deepEqual(seen, [{ args: [], stored: false }]);
});

test('a realtime failure can neither throw nor delay the sign-out', async () => {
  for (const setAuth of [
    async () => {
      throw new Error('socket broke');
    },
    () => {
      throw new Error('socket broke synchronously');
    },
    () => new Promise<void>(() => undefined),
  ]) {
    const { supabase, store } = fakeClient(async () => ({ data: null, error: null }));
    supabase.realtime = { setAuth };
    assert.equal(await signOutThisDevice(supabase), 'server');
    assert.equal(store.has(KEY), false);
  }
});

test('hasStoredSession reads the stored session from the client own storage', async () => {
  const present = fakeClient(async () => ({ error: null }));
  const absent = fakeClient(async () => ({ error: null }), null);
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
