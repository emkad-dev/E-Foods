// Domain registry: the only thing that knows how an action name becomes a
// handler. It is generic over the authenticated-context type and imports
// nothing except the dependency-free action contract, so a domain module can
// be lifted into its own Edge Function directory later without touching this
// file, and so the registry stays testable without a Supabase client.

import { ANONYMOUS_ACTIONS } from './actions.ts';

export type RpcRequestInput = {
  data: Record<string, unknown>;
  request: Request;
};

export type AuthenticatedRpcInput<TContext> = RpcRequestInput & {
  context: TContext;
};

/** Handler for an action that runs after the request has been authenticated. */
export type RpcHandler<TContext> = (input: AuthenticatedRpcInput<TContext>) => Promise<Response>;

/** Handler for an action that must run before authentication. */
export type AnonymousRpcHandler = (input: RpcRequestInput) => Promise<Response>;

export type RpcDomain<TContext> = {
  actions: readonly string[];
  anonymousHandlers: Readonly<Record<string, AnonymousRpcHandler>>;
  handlers: Readonly<Record<string, RpcHandler<TContext>>>;
  name: string;
};

const sortedKeys = (value: Record<string, unknown>) => Object.keys(value).sort();

/**
 * Builds a domain and asserts its handler maps cover exactly its declared
 * action list. The assertion runs at module load — a dropped handler takes the
 * function down at cold start rather than silently answering 501.
 */
export const defineRpcDomain = <TContext>(input: {
  actions: readonly string[];
  anonymousHandlers?: Record<string, AnonymousRpcHandler>;
  handlers: Record<string, RpcHandler<TContext>>;
  name: string;
}): RpcDomain<TContext> => {
  const anonymousHandlers = input.anonymousHandlers ?? {};
  const declared = [...input.actions].sort();
  const registered = [...sortedKeys(input.handlers), ...sortedKeys(anonymousHandlers)].sort();

  const missing = declared.filter((action) => !registered.includes(action));
  const unexpected = registered.filter((action) => !declared.includes(action));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `RPC domain "${input.name}" handler map does not match its action list.` +
        (missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : '') +
        (unexpected.length > 0 ? ` Unexpected: ${unexpected.join(', ')}.` : '')
    );
  }

  return {
    actions: input.actions,
    anonymousHandlers,
    handlers: input.handlers,
    name: input.name,
  };
};

export type RpcDispatcher<TContext> = {
  actions: readonly string[];
  findAnonymousHandler: (action: string) => AnonymousRpcHandler | null;
  findHandler: (action: string) => RpcHandler<TContext> | null;
};

/**
 * Merges domains into one lookup. Two domains may not claim the same action:
 * the flat `if (action === …)` chain this replaced resolved a duplicate by
 * source order, which is exactly the kind of accident worth failing on.
 *
 * It also enforces the pre-auth allowlist: no domain may register an
 * `anonymousHandlers` entry for an action outside `ANONYMOUS_ACTIONS`. A
 * domain adding a new pre-auth handler without updating the allowlist throws
 * here, at cold start, rather than quietly widening the set of actions
 * reachable without a JWT. (This is a one-way subset check, not a full-set
 * equality, so building a dispatcher from a subset of domains — as the test
 * suite does — is unaffected; it can never register an anonymous action that
 * isn't allowlisted, it just may not cover every allowlisted one.)
 */
export const buildDispatcher = <TContext>(
  domains: readonly RpcDomain<TContext>[]
): RpcDispatcher<TContext> => {
  const handlers = new Map<string, RpcHandler<TContext>>();
  const anonymousHandlers = new Map<string, AnonymousRpcHandler>();
  const owners = new Map<string, string>();

  for (const domain of domains) {
    for (const action of domain.actions) {
      const owner = owners.get(action);
      if (owner) {
        throw new Error(
          `RPC action "${action}" is registered by both "${owner}" and "${domain.name}".`
        );
      }
      owners.set(action, domain.name);
    }

    for (const [action, handler] of Object.entries(domain.handlers)) {
      handlers.set(action, handler);
    }

    for (const [action, handler] of Object.entries(domain.anonymousHandlers)) {
      anonymousHandlers.set(action, handler);
    }
  }

  const registeredAnonymous = [...anonymousHandlers.keys()].sort();
  const allowedAnonymous = ANONYMOUS_ACTIONS as readonly string[];
  const unallowed = registeredAnonymous.filter((action) => !allowedAnonymous.includes(action));

  if (unallowed.length > 0) {
    throw new Error(
      'RPC pre-auth registration is wider than ANONYMOUS_ACTIONS — registered but not ' +
        `allowlisted (reachable without a JWT!): ${unallowed.join(', ')}.`
    );
  }

  return {
    actions: [...owners.keys()],
    findAnonymousHandler: (action: string) => anonymousHandlers.get(action) ?? null,
    findHandler: (action: string) => handlers.get(action) ?? null,
  };
};
