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

// This file exercises the registry mechanics (defineRpcDomain's drift check,
// buildDispatcher's duplicate-action and anonymous-allowlist checks) against
// synthetic stub domains built from actions.ts's own lists. That makes
// actions.ts both the subject under test and part of the fixture for those
// mechanics tests — useful for the registry's *behavior*, but it cannot catch
// a bad edit to actions.ts itself (a rename, or the pre-auth list drifting to
// the wrong two names): the stub would just rebuild itself around the
// mutation and every assertion would still line up.
//
// The action-name CONTRACT below closes that gap: it deep-equals each
// domain's actions.ts list, and ANONYMOUS_ACTIONS, against hardcoded literal
// arrays maintained independently in this file — not derived from actions.ts
// — so a rename or a pre-auth list edit has to fail against a fixed
// expectation, not a mirror of itself.
//
// Neither this file nor its stubs touch the real domain modules
// (_shared/domains/*.ts): those statically import _shared/client.ts, which
// throws at module scope without SUPABASE_URL / SERVICE_ROLE_KEY, so a normal
// top-level import here would fail before any test runs. That real-module
// coverage — importing the actual handler maps and checking the actual
// pre-auth wiring — lives in registry.real-domains.test.ts, via a dynamic
// import that sets those two env vars first; see that file for why it's a
// separate --no-check invocation in package.json's test:deno script.

type TestContext = { uid: string };

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

const expectSameArray = (actual: readonly string[], expected: readonly string[], label: string) => {
  expectEqual(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < expected.length; i += 1) {
    expectEqual(actual[i], expected[i], `${label}[${i}]`);
  }
};

// Hardcoded, independently-maintained copies of the action contract — do NOT
// derive these from actions.ts. actions.ts is the thing being checked; these
// arrays are the fixed expectation it's checked against. A rename in
// actions.ts (even a self-consistent one, mirrored into a handler map) must
// fail one of these deep-equal checks.
const EXPECTED_ORDER_ACTIONS = [
  'customerGetOrders',
  'customerGetOrderDetail',
  'customerListFavoriteRestaurants',
  'customerToggleFavoriteRestaurant',
  'placeCustomerOrder',
  'initializeCustomerPayment',
  'refreshCustomerPaymentStatus',
  'cancelCustomerOrder',
  'customerSendSupportMessage',
  'customerGetSupportThread',
];

const EXPECTED_DISPATCH_ACTIONS = [
  'dispatchGetDeliveryQueue',
  'dispatchGetRiders',
  'dispatchGetWeeklyEarnings',
  'dispatchGetOrderDetail',
  'upsertDispatchRiderProfile',
  'syncDispatchRiderLocation',
  'dispatchAssignOrderCourier',
  'dispatchUpdateOrderStatus',
  'submitDispatchApplication',
];

const EXPECTED_PARTNER_ACTIONS = [
  'partnerGetRestaurantContext',
  'partnerGetRestaurantOrders',
  'partnerGetRestaurantOrder',
  'upsertPartnerRestaurantProfile',
  'claimPartnerRestaurantLink',
  'upsertPartnerRestaurantMenu',
  'partnerUpdateOrderStatus',
  'submitPartnerApplication',
];

const EXPECTED_ADMIN_ACTIONS = [
  'adminGetApprovalQueue',
  'adminReviewDispatchApplication',
  'adminReviewPartnerApplication',
  'adminGetDashboardSnapshot',
  'adminGetAccessOverview',
  'supportGetInbox',
  'supportGetConversation',
  'supportSendAgentReply',
  'supportSetConversationStatus',
  'supportAssignConversation',
  'broadcastList',
  'broadcastGet',
  'broadcastPreviewAudience',
  'broadcastCreate',
  'broadcastSchedule',
  'broadcastCancel',
  'promoList',
  'promoCreate',
  'promoSetActive',
  'bootstrapFirstAdmin',
];

const EXPECTED_ACCOUNT_ACTIONS = [
  'promoTrack',
  'getPolicyAcceptance',
  'recordPolicyAcceptance',
  'provisionStaffAccount',
  'assignUserRole',
  'updateUserRestaurantLink',
  'revokeUserRole',
  'disableUserAccess',
  'enableUserAccess',
  'syncUserClaims',
  'deleteOwnAccount',
  'deleteAdminAccess',
];

const EXPECTED_ANONYMOUS_ACTIONS = ['promoTrack', 'bootstrapFirstAdmin'];

Deno.test('the action contract matches a hardcoded, independently-maintained copy', () => {
  expectSameArray(ORDER_ACTIONS, EXPECTED_ORDER_ACTIONS, 'ORDER_ACTIONS');
  expectSameArray(DISPATCH_ACTIONS, EXPECTED_DISPATCH_ACTIONS, 'DISPATCH_ACTIONS');
  expectSameArray(PARTNER_ACTIONS, EXPECTED_PARTNER_ACTIONS, 'PARTNER_ACTIONS');
  expectSameArray(ADMIN_ACTIONS, EXPECTED_ADMIN_ACTIONS, 'ADMIN_ACTIONS');
  expectSameArray(ACCOUNT_ACTIONS, EXPECTED_ACCOUNT_ACTIONS, 'ACCOUNT_ACTIONS');
  expectSameArray(ANONYMOUS_ACTIONS, EXPECTED_ANONYMOUS_ACTIONS, 'ANONYMOUS_ACTIONS');
});

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

// This test is intentionally self-referential — stubDomain wires its
// anonymousHandlers straight from ANONYMOUS_ACTIONS, so of course the
// dispatcher it builds agrees with ANONYMOUS_ACTIONS. It's here to exercise
// buildDispatcher's find*Handler split (an anonymous action must resolve
// under findAnonymousHandler and NOT under findHandler, and vice versa), not
// to prove what the real pre-auth set is. That proof is the hardcoded
// contract test above (for ANONYMOUS_ACTIONS itself) plus
// registry.real-domains.test.ts (for the real modules' actual wiring).
Deno.test('buildDispatcher splits anonymous vs. authenticated lookups along ANONYMOUS_ACTIONS', () => {
  const dispatcher = buildDispatcher(
    DOMAIN_ACTION_LISTS.map(([name, actions]) => stubDomain(name, actions))
  );

  for (const action of ALL_RPC_ACTIONS) {
    const isAnonymous = (ANONYMOUS_ACTIONS as readonly string[]).includes(action);
    const hasAnonymousHandler = dispatcher.findAnonymousHandler(action) !== null;
    const hasAuthenticatedHandler = dispatcher.findHandler(action) !== null;
    expectEqual(hasAnonymousHandler, isAnonymous, `${action} anonymous-lookup registration`);
    expectEqual(hasAuthenticatedHandler, !isAnonymous, `${action} authenticated-lookup registration`);
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
