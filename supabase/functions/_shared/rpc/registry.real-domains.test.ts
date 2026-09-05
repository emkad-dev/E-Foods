// This suite imports the REAL domain modules — not the synthetic stubs used
// in registry.test.ts — and reads their actual `handlers` / `anonymousHandlers`
// maps. That distinction matters: registry.test.ts's `stubDomain` helper
// builds its fixtures from the action *list* in actions.ts, so it can never
// observe a real module wiring a handler under the wrong name, or registering
// a real action as anonymous. Only importing the real modules can.
//
// Why this lives in its own file, run with --no-check (see package.json's
// test:deno script, which invokes this file in a second, separate `deno test`
// call): the domain modules statically import `_shared/client.ts`, which
// throws at module-evaluation time unless SUPABASE_URL / SERVICE_ROLE_KEY are
// set. A normal top-level `import` is hoisted and evaluated before any test
// body runs, so there's no way to set those env vars first. A dynamic
// `import()` defers evaluation until it's awaited, so we set the env vars,
// then import. The domain modules also carry pre-existing `deno check` type
// errors (tracked separately — out of scope for this task; see
// task-1-report.md), which would otherwise fail this file under Deno's
// default type-checking; --no-check sidesteps that without touching the
// other, already-clean files in test:deno.

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const [
  { ordersDomain },
  { dispatchDomain },
  { partnerDomain },
  { adminDomain },
  { accountDomain },
] = await Promise.all([
  import('../domains/orders.ts'),
  import('../domains/dispatch.ts'),
  import('../domains/partner.ts'),
  import('../domains/admin.ts'),
  import('../domains/account.ts'),
]);

const { buildDispatcher } = await import('./registry.ts');
const { ALL_RPC_ACTIONS } = await import('./actions.ts');

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

const REAL_DOMAINS = [ordersDomain, dispatchDomain, partnerDomain, adminDomain, accountDomain];

// An independent copy of the pre-auth contract — deliberately not derived
// from ANONYMOUS_ACTIONS in actions.ts. The point of this file is to check
// the real modules against a fixed expectation that a rename or an added
// `anonymousHandlers` entry elsewhere can't quietly satisfy.
const EXPECTED_ANONYMOUS_ACTIONS = ['bootstrapFirstAdmin', 'promoTrack'];

Deno.test('the real domain modules register exactly promoTrack and bootstrapFirstAdmin as pre-auth', () => {
  const registeredAnonymous = new Set<string>();
  for (const domain of REAL_DOMAINS) {
    for (const action of Object.keys(domain.anonymousHandlers)) {
      registeredAnonymous.add(action);
    }
  }

  const actual = [...registeredAnonymous].sort();
  const expected = [...EXPECTED_ANONYMOUS_ACTIONS].sort();

  expectEqual(actual.length, expected.length, 'real anonymous action count');
  for (let i = 0; i < expected.length; i += 1) {
    expectEqual(actual[i], expected[i], `real anonymous action[${i}]`);
  }

  // And the flip side: every action NOT in the expected pre-auth set must be
  // a real authenticated handler somewhere, never an anonymous one. This is
  // the check that catches a later domain module quietly adding a JWT-free
  // handler for an action that should require auth.
  for (const domain of REAL_DOMAINS) {
    for (const action of Object.keys(domain.anonymousHandlers)) {
      if (!expected.includes(action)) {
        throw new Error(
          `domain "${domain.name}" registers "${action}" as anonymous, but it is not in the ` +
            'expected pre-auth allowlist — this action would be reachable without a JWT.'
        );
      }
    }
  }
});

Deno.test('the real domain modules together register all 77 handlers, none pre-auth but the two allowed', () => {
  expectEqual(ALL_RPC_ACTIONS.length, 77, 'ALL_RPC_ACTIONS length');

  const dispatcher = buildDispatcher(REAL_DOMAINS);
  expectEqual(dispatcher.actions.length, 77, 'real dispatcher action count');

  for (const action of ALL_RPC_ACTIONS) {
    const isAnonymous = EXPECTED_ANONYMOUS_ACTIONS.includes(action);
    const handler = isAnonymous
      ? dispatcher.findAnonymousHandler(action)
      : dispatcher.findHandler(action);

    if (typeof handler !== 'function') {
      throw new Error(
        `no real ${isAnonymous ? 'anonymous ' : ''}handler registered for "${action}"`
      );
    }

    // And the action must NOT also resolve under the other lookup — an
    // authenticated action reachable via findAnonymousHandler would bypass
    // auth entirely.
    const other = isAnonymous
      ? dispatcher.findHandler(action)
      : dispatcher.findAnonymousHandler(action);
    if (other !== null) {
      throw new Error(`"${action}" resolves under both the authenticated and anonymous lookup`);
    }
  }
});
