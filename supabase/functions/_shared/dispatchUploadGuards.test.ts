// Handler-level guards on submitDispatchApplication: the per-user rate limit
// (429) and the upload mime/size bounds (400, with the storage upload never
// reached). Calls the REAL handler out of dispatchDomain.handlers with a fake
// serviceClient.rpc / storage; see domains/adminSetRestaurantPublished.test.ts
// for why the env stubs + dynamic imports are needed and why this file is in
// the --no-check list.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { dispatchDomain } = await import('./domains/dispatch.ts');
const { serviceClient } = await import('./client.ts');
const { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } = await import('./policyAcceptance.ts');

const handler = dispatchDomain.handlers.submitDispatchApplication;
if (typeof handler !== 'function') throw new Error('submitDispatchApplication is not registered.');

const CONTEXT = {
  email: 'rider@example.test',
  role: 'dispatch',
  token: 'fake-token',
  uid: 'rider-uid',
  userProfile: { uid: 'rider-uid', email: 'rider@example.test', role: 'dispatch', accountDisabled: false },
};

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'Test Rider',
  phoneNumber: '+2348012345678',
  region: 'Lagos',
  lga: 'Ikeja',
  vehicleType: 'bike',
  vehicleMake: 'Honda',
  vehicleModel: 'CG125',
  vehiclePlateNumber: 'ABC123',
  licenseNumber: 'LIC123',
  licenceFrontBase64: 'AAAA',
  licenceBackBase64: 'AAAA',
  licenceFrontMimeType: 'image/jpeg',
  licenceBackMimeType: 'image/jpeg',
  policyAcceptance: {
    accepted: true,
    app: 'dispatch',
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    source: 'dispatch_signup',
  },
  ...overrides,
});

// deno-lint-ignore no-explicit-any
const svc = serviceClient as any;

const install = (rpcResult: { data: unknown; error: unknown }) => {
  const state = { rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>, uploads: 0 };
  const originalRpc = svc.rpc;
  const originalStorage = Object.getOwnPropertyDescriptor(svc, 'storage');
  svc.rpc = (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args });
    return Promise.resolve(rpcResult);
  };
  Object.defineProperty(svc, 'storage', {
    configurable: true,
    value: {
      from: () => ({
        upload: () => {
          state.uploads += 1;
          return Promise.resolve({ error: null });
        },
      }),
    },
  });
  const restore = () => {
    svc.rpc = originalRpc;
    if (originalStorage) Object.defineProperty(svc, 'storage', originalStorage);
    else delete svc.storage;
  };
  return { state, restore };
};

const statusOfCall = async (data: Record<string, unknown>): Promise<number | null> => {
  try {
    // deno-lint-ignore no-explicit-any
    await (handler as any)({ context: CONTEXT, data, request: new Request('https://example.test/rpc', { method: 'POST' }) });
    return null;
    // deno-lint-ignore no-explicit-any
  } catch (e: any) {
    return e?.status ?? -1;
  }
};

Deno.test('submitDispatchApplication: 429 when auth_rl_hit says not allowed', async () => {
  const { state, restore } = install({ data: [{ allowed: false }], error: null });
  try {
    const status = await statusOfCall(basePayload());
    if (status !== 429) throw new Error(`expected 429, got ${status}`);
    const call = state.rpcCalls[0];
    if (
      call?.fn !== 'auth_rl_hit' ||
      call.args.p_key !== 'dispatch:apply:rider-uid' ||
      call.args.p_limit !== 3 ||
      call.args.p_window_secs !== 3600 ||
      call.args.p_lockout_secs !== 900
    ) {
      throw new Error(`unexpected rpc call ${JSON.stringify(call)}`);
    }
    if (state.uploads !== 0) throw new Error('storage upload must not run when rate limited');
  } finally {
    restore();
  }
});

Deno.test('submitDispatchApplication: 400 on a pdf document, storage never called', async () => {
  const { state, restore } = install({ data: [{ allowed: true }], error: null });
  try {
    const status = await statusOfCall(basePayload({ licenceFrontMimeType: 'application/pdf' }));
    if (status !== 400) throw new Error(`expected 400, got ${status}`);
    if (state.uploads !== 0) throw new Error('storage upload must not run for a rejected document');
  } finally {
    restore();
  }
});

Deno.test('submitDispatchApplication: 400 on a missing mime, storage never called', async () => {
  const { state, restore } = install({ data: [{ allowed: true }], error: null });
  try {
    const status = await statusOfCall(basePayload({ licenceBackMimeType: undefined }));
    if (status !== 400) throw new Error(`expected 400, got ${status}`);
    if (state.uploads !== 0) throw new Error('storage upload must not run for a missing mime');
  } finally {
    restore();
  }
});

Deno.test('submitDispatchApplication: 400 on an oversize document, storage never called', async () => {
  const { state, restore } = install({ data: [{ allowed: true }], error: null });
  try {
    const status = await statusOfCall(basePayload({ licenceFrontBase64: 'A'.repeat(8_000_000) }));
    if (status !== 400) throw new Error(`expected 400, got ${status}`);
    if (state.uploads !== 0) throw new Error('storage upload must not run for an oversize document');
  } finally {
    restore();
  }
});
