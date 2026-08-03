import {
  ACCOUNT_ACTIONS,
  ADMIN_ACTIONS,
  ALL_RPC_ACTIONS,
  ANONYMOUS_ACTIONS,
  DISPATCH_ACTIONS,
  ORDER_ACTIONS,
  PARTNER_ACTIONS,
} from './actions.ts';
import { buildDispatcher, defineRpcDomain, type RpcDomain } from './registry.ts';

// The domain modules themselves cannot be imported here: they reach
// _shared/client.ts, which throws at module scope without SUPABASE_URL /
// SERVICE_ROLE_KEY (the same reason auth-gateway/otp.test.ts is excluded from
// the suite). actions.ts is dependency-free so the action contract stays
// testable, and defineRpcDomain re-checks each domain's handler map against its
// list at cold start, which is where a dropped handler surfaces.

type TestContext = { uid: string };

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

const okResponse = () => Promise.resolve(new Response('ok'));

const stubDomain = (name: string, actions: readonly string[]): RpcDomain<TestContext> =>
  defineRpcDomain<TestContext>({
    actions,
    name,
    anonymousHandlers: Object.fromEntries(
      actions.filter((action) => (ANONYMOUS_ACTIONS as readonly string[]).includes(action)).map((action) => [action, okResponse])
    ),
    handlers: Object.fromEntries(
      actions
        .filter((action) => !(ANONYMOUS_ACTIONS as readonly string[]).includes(action))
        .map((action) => [action, okResponse])
    ),
  });

const DOMAIN_ACTION_LISTS: Array<[string, readonly string[], number]> = [
  ['orders', ORDER_ACTIONS, 10],
  ['dispatch', DISPATCH_ACTIONS, 9],
  ['partner', PARTNER_ACTIONS, 8],
  ['admin', ADMIN_ACTIONS, 20],
  ['account', ACCOUNT_ACTIONS, 12],
];

for (const [name, actions, expectedCount] of DOMAIN_ACTION_LISTS) {
  Deno.test(`${name} domain routes every declared action and rejects unknown ones`, () => {
    expectEqual(actions.length, expectedCount, `${name} action count`);

    const dispatcher = buildDispatcher([stubDomain(name, actions)]);

    for (const action of actions) {
      const isAnonymous = (ANONYMOUS_ACTIONS as readonly string[]).includes(action);
      const handler = isAnonymous
        ? dispatcher.findAnonymousHandler(action)
        : dispatcher.findHandler(action);

      if (typeof handler !== 'function') {
        throw new Error(`${name}: no handler registered for "${action}"`);
      }
    }

    // An unregistered action resolves to no handler, which the entrypoint turns
    // into the 501 "not implemented in the native Supabase backend" response.
    expectEqual(dispatcher.findHandler('thisActionDoesNotExist'), null, 'unknown handler');
    expectEqual(
      dispatcher.findAnonymousHandler('thisActionDoesNotExist'),
      null,
      'unknown anonymous handler'
    );
  });
}

Deno.test('the five domains together cover exactly the 59-action surface', () => {
  const union = [
    ...ORDER_ACTIONS,
    ...DISPATCH_ACTIONS,
    ...PARTNER_ACTIONS,
    ...ADMIN_ACTIONS,
    ...ACCOUNT_ACTIONS,
  ];

  expectEqual(union.length, 59, 'total action count');
  expectEqual(new Set(union).size, 59, 'unique action count');
  expectEqual(ALL_RPC_ACTIONS.length, 59, 'ALL_RPC_ACTIONS length');

  const dispatcher = buildDispatcher(
    DOMAIN_ACTION_LISTS.map(([name, actions]) => stubDomain(name, actions))
  );
  expectEqual(dispatcher.actions.length, 59, 'dispatcher action count');

  for (const action of ALL_RPC_ACTIONS) {
    if (!dispatcher.actions.includes(action)) {
      throw new Error(`dispatcher is missing "${action}"`);
    }
  }
});

Deno.test('promoTrack and bootstrapFirstAdmin are the only pre-auth actions', () => {
  expectEqual(ANONYMOUS_ACTIONS.length, 2, 'anonymous action count');

  const dispatcher = buildDispatcher(
    DOMAIN_ACTION_LISTS.map(([name, actions]) => stubDomain(name, actions))
  );

  for (const action of ALL_RPC_ACTIONS) {
    const isAnonymous = (ANONYMOUS_ACTIONS as readonly string[]).includes(action);
    const hasAnonymousHandler = dispatcher.findAnonymousHandler(action) !== null;
    expectEqual(hasAnonymousHandler, isAnonymous, `${action} pre-auth registration`);
  }
});

Deno.test('defineRpcDomain refuses a handler map that drifts from its action list', () => {
  let missingThrew = false;
  try {
    defineRpcDomain<TestContext>({
      actions: ['alpha', 'beta'],
      name: 'drift',
      handlers: { alpha: okResponse },
    });
  } catch {
    missingThrew = true;
  }
  expectEqual(missingThrew, true, 'missing handler should throw');

  let unexpectedThrew = false;
  try {
    defineRpcDomain<TestContext>({
      actions: ['alpha'],
      name: 'drift',
      handlers: { alpha: okResponse, gamma: okResponse },
    });
  } catch {
    unexpectedThrew = true;
  }
  expectEqual(unexpectedThrew, true, 'unexpected handler should throw');
});

Deno.test('buildDispatcher refuses two domains claiming the same action', () => {
  let threw = false;
  try {
    buildDispatcher([stubDomain('first', ['sharedAction']), stubDomain('second', ['sharedAction'])]);
  } catch {
    threw = true;
  }
  expectEqual(threw, true, 'duplicate action should throw');
});
