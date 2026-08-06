// Pure helpers shared by scripts/generate-rpc-routes.mjs (the CLI that writes
// packages/domain/src/rpcRoutes.ts) and packages/domain/src/rpcRoutes.test.ts
// (the drift check that reads both sides and asserts they agree).
//
// This file has zero side effects at import time on purpose: importing it
// must never write anything, so the test can use it to recompute the
// expected routes from supabase/functions/_shared/rpc/actions.ts without
// risk of silently "fixing" a drifted rpcRoutes.ts instead of failing on it.
//
// Deliberately plain JS (not TS): it is invoked directly by `node` for
// codegen, and imported by the Node test runner, neither of which need type
// stripping for a file this small.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export const ACTIONS_SOURCE_PATH = path.join(
  REPO_ROOT,
  'supabase',
  'functions',
  '_shared',
  'rpc',
  'actions.ts'
);

export const RPC_ROUTES_OUTPUT_PATH = path.join(REPO_ROOT, 'packages', 'domain', 'src', 'rpcRoutes.ts');

// Domain -> deployed Edge Function name, per Task 2 of the parity plan.
export const DOMAIN_FUNCTIONS = [
  { constName: 'ORDER_ACTIONS', fn: 'feasty-orders' },
  { constName: 'DISPATCH_ACTIONS', fn: 'feasty-dispatch' },
  { constName: 'PARTNER_ACTIONS', fn: 'feasty-partner' },
  { constName: 'ADMIN_ACTIONS', fn: 'feasty-admin' },
  { constName: 'ACCOUNT_ACTIONS', fn: 'feasty-account' },
];

export const LEGACY_RPC_FUNCTION = 'app-rpc';

// The fixed action-count contract from the Task 3 brief. extractActionArray's
// regex parse of actions.ts has a dangerous failure mode: a PARTIAL match. If
// actions.ts is reformatted (an array collapsed to one line, a comment
// inserted, a trailing comma moved) the regex could match a subset of an
// array instead of failing outright — generation and the drift check would
// then silently agree with each other while both being wrong. These counts
// let buildRpcRoutes catch that: a parse that doesn't land on exactly these
// numbers fails generation loudly instead of writing a quietly-wrong route
// table.
export const EXPECTED_DOMAIN_ACTION_COUNTS = {
  ORDER_ACTIONS: 10,
  DISPATCH_ACTIONS: 9,
  PARTNER_ACTIONS: 8,
  ADMIN_ACTIONS: 20,
  ACCOUNT_ACTIONS: 12,
};

export const EXPECTED_TOTAL_ACTION_COUNT = 59;

/**
 * Extracts a `export const NAME = ['a', 'b'] as const;` string-literal array
 * from actions.ts source text. Throws if the const isn't found or parses to
 * zero entries, so a rename in actions.ts breaks generation loudly instead of
 * silently producing an empty route table.
 */
export function extractActionArray(source, constName) {
  const re = new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\]\\s*as const;`);
  const match = source.match(re);
  if (!match) {
    throw new Error(`generate-rpc-routes: could not find "export const ${constName} = [...] as const;" in actions.ts`);
  }
  const items = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (items.length === 0) {
    throw new Error(`generate-rpc-routes: "${constName}" parsed to zero actions`);
  }
  return items;
}

/**
 * Parses actions.ts source text into the action -> function route table plus
 * the anonymous-action allowlist. Throws if the same action name appears
 * under more than one domain (actions.ts's own registry tests already forbid
 * this at the Deno layer; this is the Node-side mirror of that guarantee),
 * and throws if any domain's parsed count (or the grand total) doesn't match
 * EXPECTED_DOMAIN_ACTION_COUNTS / EXPECTED_TOTAL_ACTION_COUNT — see the
 * comment on those constants for why that matters.
 */
export function buildRpcRoutes(actionsSource) {
  const rpcRoutes = {};
  let total = 0;

  for (const { constName, fn } of DOMAIN_FUNCTIONS) {
    const actions = extractActionArray(actionsSource, constName);
    const expectedCount = EXPECTED_DOMAIN_ACTION_COUNTS[constName];

    if (actions.length !== expectedCount) {
      throw new Error(
        `generate-rpc-routes: "${constName}" parsed to ${actions.length} action(s), expected exactly ${expectedCount}. ` +
          'A partial regex match (reformatted array, inserted comment, moved comma) must fail generation loudly ' +
          'rather than silently produce a wrong route table.'
      );
    }

    for (const action of actions) {
      if (Object.prototype.hasOwnProperty.call(rpcRoutes, action)) {
        throw new Error(`generate-rpc-routes: action "${action}" appears in more than one domain`);
      }
      rpcRoutes[action] = fn;
    }

    total += actions.length;
  }

  if (total !== EXPECTED_TOTAL_ACTION_COUNT || Object.keys(rpcRoutes).length !== EXPECTED_TOTAL_ACTION_COUNT) {
    throw new Error(
      `generate-rpc-routes: parsed ${total} total action(s) across all domains (${Object.keys(rpcRoutes).length} unique), expected exactly ${EXPECTED_TOTAL_ACTION_COUNT}.`
    );
  }

  const anonymousActions = extractActionArray(actionsSource, 'ANONYMOUS_ACTIONS');

  return { rpcRoutes, anonymousActions };
}

/** Renders the full contents of the generated packages/domain/src/rpcRoutes.ts file. */
export function renderRpcRoutesModule({ rpcRoutes, anonymousActions }) {
  const routeEntries = Object.entries(rpcRoutes)
    .map(([action, fn]) => `  ${JSON.stringify(action)}: '${fn}',`)
    .join('\n');
  const anonymousEntries = anonymousActions.map((action) => JSON.stringify(action)).join(', ');

  return `// AUTO-GENERATED — DO NOT HAND-EDIT.
//
// Generated by scripts/generate-rpc-routes.mjs from the single source of
// truth for the action -> domain mapping,
// supabase/functions/_shared/rpc/actions.ts. Run
// \`npm run generate:rpc-routes\` after changing the action lists there.
//
// packages/domain/src/rpcRoutes.test.ts re-parses actions.ts independently
// and fails npm run test:node if this file has drifted from it, so a hand
// edit (or a forgotten regeneration) is caught by the test suite rather than
// discovered at a misrouted runtime call.

export type RpcFunction =
  | 'feasty-orders'
  | 'feasty-dispatch'
  | 'feasty-partner'
  | 'feasty-admin'
  | 'feasty-account';

/** The compatibility shim every action already routes through today. */
export const LEGACY_RPC_FUNCTION = '${LEGACY_RPC_FUNCTION}' as const;

/** 'split' (default) sends each action to its own domain function; 'legacy' is the kill switch back to the app-rpc shim. */
export type RpcMode = 'split' | 'legacy';

/**
 * Every possible resolved RPC call target: one of the five split-mode domain
 * functions, or the legacy app-rpc shim. Kept as a closed union (not
 * \`string\`) so a caller can't launder an arbitrary string through
 * resolveRpcTarget and have it typecheck.
 */
export type RpcTarget = RpcFunction | typeof LEGACY_RPC_FUNCTION;

/** The authoritative action -> split-mode Edge Function map. Covers exactly the 59 actions in actions.ts. */
export const RPC_ROUTES: Record<string, RpcFunction> = {
${routeEntries}
};

/** Actions that must be resolvable (and, server-side, callable) before authentication. Mirrors actions.ts's ANONYMOUS_ACTIONS. */
export const ANONYMOUS_RPC_ACTIONS: readonly string[] = [${anonymousEntries}];

/**
 * Resolves the split-mode Edge Function for an action. Throws on an unknown
 * action — a typo'd action name must fail loudly at the call site, never
 * silently hit the wrong function.
 */
export const resolveRpcFunction = (action: string): RpcFunction => {
  const fn = RPC_ROUTES[action];
  if (!fn) {
    throw new Error(\`Unknown RPC action: "\${action}"\`);
  }
  return fn;
};

/**
 * Resolves the function to actually call for an action given the current RPC
 * mode. In 'legacy' mode every known action routes to the app-rpc
 * compatibility shim (the kill switch for a bad split-function deploy);
 * otherwise it routes to the action's split-mode domain function. An unknown
 * action always throws, in either mode — the kill switch recovers a bad
 * deploy, it does not mask a routing typo.
 */
export const resolveRpcTarget = (action: string, mode: RpcMode): RpcTarget => {
  const splitFunction = resolveRpcFunction(action);
  return mode === 'legacy' ? LEGACY_RPC_FUNCTION : splitFunction;
};

/**
 * Normalizes an EXPO_PUBLIC_RPC_MODE / VITE_RPC_MODE env value. Unset,
 * blank, or unrecognized values resolve to 'split' (the safe default)
 * rather than throwing, so a missing or mistyped env var never breaks
 * routing — only the literal value 'legacy' (case-insensitive, trimmed)
 * activates the kill switch.
 */
export const resolveRpcMode = (value: string | undefined | null): RpcMode =>
  value?.trim().toLowerCase() === 'legacy' ? 'legacy' : 'split';
`;
}
