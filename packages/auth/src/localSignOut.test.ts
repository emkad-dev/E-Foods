/**
 * Run with: node --test --experimental-strip-types packages/auth/src/localSignOut.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { bestEffortWithin, hasStoredSession, isReconcileStillValid, signOutThisDevice } from './localSignOut.ts';

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

// A settled refresh has already written its session back (`_callRefreshToken`
// saves, notifies, then resolves the deferred), which is what these fakes model.
const refreshedSession = (accessToken: string) => ({ data: { access_token: accessToken }, error: null });
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const refreshInFlight = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('a refresh that writes the session back after the removal is swept and revoked', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const refresh = refreshInFlight();
  const notified: unknown[][] = [];
  client.supabase.auth.refreshingDeferred = { promise: refresh.promise };
  client.supabase.auth._notifyAllSubscribers = async (...args: unknown[]) => void notified.push(args);

  await signOutThisDevice(client.supabase);
  assert.equal(client.store.has(KEY), false);
  // The ordinary removal stays silent: its callers clear their own state.
  assert.deepEqual(notified, []);

  const rewritten = JSON.stringify({ access_token: 'refreshed-token', refresh_token: 'r3' });
  client.store.set(KEY, rewritten);
  client.store.set(`${KEY}-user`, '{}');
  refresh.resolve(refreshedSession('refreshed-token'));
  await settle();

  assert.equal(client.store.has(KEY), false);
  assert.equal(client.store.has(`${KEY}-user`), false);
  assert.deepEqual(client.adminCalls, [
    ['old-token', 'local'],
    ['refreshed-token', 'local'],
  ]);
  assert.deepEqual(notified, [['SIGNED_OUT', null]]);
});

test('the sign-out does not wait for a refresh still in flight', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  client.supabase.auth.refreshingDeferred = { promise: new Promise(() => undefined) };
  assert.equal(await signOutThisDevice(client.supabase), 'server');
  assert.equal(client.store.has(KEY), false);
});

test('a newer session stored meanwhile is left alone', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const refresh = refreshInFlight();
  const notified: unknown[][] = [];
  client.supabase.auth.refreshingDeferred = { promise: refresh.promise };
  client.supabase.auth._notifyAllSubscribers = async (...args: unknown[]) => void notified.push(args);

  await signOutThisDevice(client.supabase);
  client.store.set(KEY, NEW_SESSION);
  refresh.resolve(refreshedSession('refreshed-token'));
  await settle();

  assert.equal(client.store.get(KEY), NEW_SESSION);
  assert.deepEqual(client.adminCalls, [['old-token', 'local']]);
  assert.deepEqual(notified, []);
});

test('a refresh that wrote nothing back leaves nothing to revoke', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const refresh = refreshInFlight();
  client.supabase.auth.refreshingDeferred = { promise: refresh.promise };

  await signOutThisDevice(client.supabase);
  refresh.resolve(refreshedSession('refreshed-token'));
  await settle();

  assert.deepEqual(client.adminCalls, [['old-token', 'local']]);
});

test('with no refresh in flight there is no second pass', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  client.supabase.auth.refreshingDeferred = null;
  await signOutThisDevice(client.supabase);
  client.store.set(KEY, NEW_SESSION);
  await settle();
  assert.equal(client.store.get(KEY), NEW_SESSION);
  assert.equal(client.storageReads(), 1);
});

test('a refresh that rejects or answers with no session does nothing and throws nothing', async () => {
  for (const finish of [
    (refresh: ReturnType<typeof refreshInFlight>) => refresh.reject(new Error('boom')),
    (refresh: ReturnType<typeof refreshInFlight>) => refresh.resolve({ data: null, error: new Error('refused') }),
    (refresh: ReturnType<typeof refreshInFlight>) => refresh.resolve(null),
  ]) {
    const client = fakeClient(async () => ({ data: null, error: null }));
    const refresh = refreshInFlight();
    client.supabase.auth.refreshingDeferred = { promise: refresh.promise };

    await signOutThisDevice(client.supabase);
    client.store.set(KEY, NEW_SESSION);
    finish(refresh);
    await settle();

    assert.equal(client.store.get(KEY), NEW_SESSION);
    assert.deepEqual(client.adminCalls, [['old-token', 'local']]);
  }
});

test('a listener that throws during the sweep still lets the revoke go out', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const refresh = refreshInFlight();
  client.supabase.auth.refreshingDeferred = { promise: refresh.promise };
  client.supabase.auth._notifyAllSubscribers = async () => {
    throw new Error('listener broke');
  };

  await signOutThisDevice(client.supabase);
  client.store.set(KEY, JSON.stringify({ access_token: 'refreshed-token' }));
  refresh.resolve(refreshedSession('refreshed-token'));
  await settle();

  assert.equal(client.store.has(KEY), false);
  assert.deepEqual(client.adminCalls.at(-1), ['refreshed-token', 'local']);
});

test('a failing revoke during the sweep still removes the session and throws nothing', async () => {
  const client = fakeClient(async (jwt) => {
    if (jwt === 'refreshed-token') {
      throw new TypeError('Failed to fetch');
    }
    return { data: null, error: null };
  });
  const refresh = refreshInFlight();
  client.supabase.auth.refreshingDeferred = { promise: refresh.promise };

  await signOutThisDevice(client.supabase);
  client.store.set(KEY, JSON.stringify({ access_token: 'refreshed-token' }));
  refresh.resolve(refreshedSession('refreshed-token'));
  await settle();

  assert.equal(client.store.has(KEY), false);
});

// Against the real auth-js rather than a fake: `refreshingDeferred`, `storage` and
// `_notifyAllSubscribers` are not public, so an upgrade could rename them with no
// type error, and the sweep would silently stop working. This fails if that happens.
test('the real auth-js client: an in-flight refresh cannot undo the sign-out', async () => {
  const expiredAt = Math.floor(Date.now() / 1000) - 60;
  const key = 'sb-test-auth-token';
  const store = new Map<string, string>([
    [
      key,
      JSON.stringify({
        access_token: 'expired-token',
        refresh_token: 'refresh-1',
        expires_at: expiredAt,
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'user-1' },
      }),
    ],
  ]);
  const logoutTokens: Array<string | null> = [];
  let answerRefresh!: () => void;
  const refreshAnswered = new Promise<void>((resolve) => {
    answerRefresh = resolve;
  });

  const fetchStub = async (input: unknown, init?: { headers?: unknown }) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/logout')) {
      logoutTokens.push(new Headers(init?.headers as never).get('Authorization'));
      return new Response(null, { status: 204 });
    }
    if (url.includes('grant_type=refresh_token')) {
      await refreshAnswered;
      return new Response(
        JSON.stringify({
          access_token: 'refreshed-token',
          refresh_token: 'refresh-2',
          expires_in: 3600,
          expires_at: expiredAt + 7200,
          token_type: 'bearer',
          user: { id: 'user-1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('grant_type=password')) {
      return new Response(
        JSON.stringify({
          access_token: 'password-token',
          refresh_token: 'refresh-3',
          expires_in: 3600,
          expires_at: expiredAt + 7200,
          token_type: 'bearer',
          user: { id: 'user-1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const client = createClient('https://test.supabase.co', 'anon-key', {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      storageKey: key,
      storage: {
        getItem: async (k: string) => store.get(k) ?? null,
        // Really asynchronous, like AsyncStorage, so a save that is not awaited
        // before the event would be caught below.
        setItem: async (k: string, value: string) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          store.set(k, value);
        },
        removeItem: async (k: string) => void store.delete(k),
      },
    },
    global: { fetch: fetchStub as typeof fetch },
  });

  await client.auth.initialize();
  assert.ok('refreshingDeferred' in client.auth, 'auth-js no longer has refreshingDeferred');

  // Starts the refresh, and it is stuck on the network.
  const startedRefresh = client.auth.getSession();
  await settle();
  assert.ok((client.auth as any).refreshingDeferred, 'the refresh should be in flight');

  await signOutThisDevice(client as never);
  assert.equal(store.has(key), false);

  const events: string[] = [];
  const validityAtListenerTime: Array<Promise<boolean>> = [];
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    events.push(event);
    if (event === 'SIGNED_IN') {
      validityAtListenerTime.push(
        isReconcileStillValid(client, session),
        isReconcileStillValid(client, { user: { id: 'someone-else' } })
      );
    }
  });

  // The network comes back: auth-js writes the session back and resolves.
  answerRefresh();
  await startedRefresh;
  await settle();

  assert.equal(store.has(key), false, 'the written-back session must be swept');
  assert.deepEqual(logoutTokens, ['Bearer expired-token', 'Bearer refreshed-token']);
  assert.ok(events.includes('SIGNED_OUT'), 'a listener must hear that the session was swept');

  // A real sign-in: when the listener hears about it, the session must already be
  // stored in the shape the reconcile check reads. The second answer proves the
  // check really compared an identity rather than finding none and allowing it.
  await client.auth.signInWithPassword({ email: 'a@example.com', password: 'password' });
  assert.deepEqual(await Promise.all(validityAtListenerTime), [true, false]);

  subscription.unsubscribe();
  await client.realtime.disconnect();
});

const STORED_USER = (id: string, accessToken = 'token') =>
  JSON.stringify({ access_token: accessToken, refresh_token: 'r', expires_at: 1, user: { id } });

const reconcileClient = (stored: string | null) => {
  const store = new Map<string, string>(stored ? [[KEY, stored]] : []);
  return {
    auth: {
      storageKey: KEY,
      storage: {
        getItem: async (k: string) => store.get(k) ?? null,
        removeItem: async (k: string) => void store.delete(k),
      },
    },
  };
};

const SESSION = { access_token: 'token-before-refresh', user: { id: 'user-a' } };

test('a token rotated mid-reconcile for the same user is still valid', async () => {
  const supabase = reconcileClient(STORED_USER('user-a', 'token-after-refresh'));
  assert.equal(await isReconcileStillValid(supabase, SESSION), true);
});

test('no stored session means the reconcile outlived a sign-out', async () => {
  assert.equal(await isReconcileStillValid(reconcileClient(null), SESSION), false);
});

test('a session stored for a different user makes the reconcile stale', async () => {
  assert.equal(await isReconcileStillValid(reconcileClient(STORED_USER('user-b')), SESSION), false);
});

test('a storage read failure counts as still valid, so a hiccup drops nobody', async () => {
  const supabase = {
    auth: {
      storageKey: KEY,
      storage: {
        getItem: async () => {
          throw new Error('storage broke');
        },
        removeItem: async () => undefined,
      },
    },
  };
  assert.equal(await isReconcileStillValid(supabase, SESSION), true);
  assert.equal(await isReconcileStillValid(reconcileClient('not json'), SESSION), true);
  assert.equal(await isReconcileStillValid({ auth: {} }, SESSION), true);
});

const jwtFor = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

// auth-js strips `user` from the stored record when a userStorage is configured
// (keeping it under `-user`), so the JWT is the one identity always stored.
test('a stored session with no user falls back to the JWT subject', async () => {
  const stored = (sub: string) => JSON.stringify({ access_token: jwtFor({ sub }), refresh_token: 'r' });
  assert.equal(await isReconcileStillValid(reconcileClient(stored('user-a')), SESSION), true);
  assert.equal(await isReconcileStillValid(reconcileClient(stored('user-b')), SESSION), false);
});

test('a stored session with no readable identity counts as still valid', async () => {
  const stored = JSON.stringify({ access_token: 'not-a-jwt', refresh_token: 'r' });
  assert.equal(await isReconcileStillValid(reconcileClient(stored), SESSION), true);
});

test('a reconcile with no session to compare is left alone', async () => {
  assert.equal(await isReconcileStillValid(reconcileClient(null), null), true);
  assert.equal(await isReconcileStillValid(reconcileClient(null), { user: null }), true);
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
