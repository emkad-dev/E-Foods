// Guards against DANGLING ACTION NAMES: a string compared against the
// incoming `action` that no action list contains and no handler answers.
//
// The bug this exists for: the RPC split shipped
//
//     allowPendingDeletion: action === 'cancelAccountDeletion',
//
// in rpc/context.ts. `cancelAccountDeletion` is in no action list, has no
// handler, and 501s if called. The pending-deletion exemption — the one
// documented way out of a state the production database actively enforces
// (403 ACCOUNT_PENDING_DELETION, plus an RLS freeze that stops the user
// clearing the flag themselves) — therefore pointed at nothing, while the
// comment above it promised a restore path. Nothing failed, because nothing
// checked. See docs/account-deletion-design.md.
//
// Two assertions, because the first alone can be walked around:
//   1. every name in PENDING_DELETION_EXEMPT_ACTIONS is a real, dispatchable
//      action (the semantic guarantee);
//   2. rpc/context.ts routes the exemption THROUGH that list rather than
//      comparing `action` to a bare string literal (so 1. cannot be bypassed
//      by reintroducing the original shape).
//
// Like registry.test.ts this file imports ONLY actions.ts, which is
// deliberately dependency-free. It must not import context.ts: that pulls in
// _shared/client.ts, which throws at module scope without SUPABASE_URL /
// SERVICE_ROLE_KEY. context.ts is inspected as TEXT instead, which is also why
// this file can stay in the type-checked first half of `test:deno`.

import { ALL_RPC_ACTIONS, PENDING_DELETION_EXEMPT_ACTIONS } from './actions.ts';

const CONTEXT_SOURCE_URL = new URL('./context.ts', import.meta.url);

Deno.test('every pending-deletion exempt action exists in ALL_RPC_ACTIONS', () => {
  const known = new Set<string>(ALL_RPC_ACTIONS);
  const dangling = PENDING_DELETION_EXEMPT_ACTIONS.filter((action) => !known.has(action));

  if (dangling.length > 0) {
    throw new Error(
      `PENDING_DELETION_EXEMPT_ACTIONS names ${dangling.length} action(s) that do not exist ` +
        `in ALL_RPC_ACTIONS: ${dangling.join(', ')}. ` +
        'An exempt action that has no handler 501s, so the exemption grants nothing and the ' +
        'pending-deletion state becomes inescapable. Either register a handler for it (see ' +
        'docs/account-deletion-design.md) or remove it from the list.'
    );
  }
});

Deno.test('PENDING_DELETION_EXEMPT_ACTIONS holds no duplicates', () => {
  const seen = new Set<string>();
  for (const action of PENDING_DELETION_EXEMPT_ACTIONS) {
    if (seen.has(action)) {
      throw new Error(`PENDING_DELETION_EXEMPT_ACTIONS lists '${action}' more than once.`);
    }
    seen.add(action);
  }
});

Deno.test('rpc/context.ts derives the exemption from the list, not a bare literal', async () => {
  const source = await Deno.readTextFile(CONTEXT_SOURCE_URL);

  // Strip line and block comments so the cautionary comment in context.ts —
  // which quotes the original `action === 'cancelAccountDeletion'` on purpose
  // — does not trip the literal check below.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const bareComparison = /\baction\s*(?:===|!==|==|!=)\s*['"`]/.exec(code);
  if (bareComparison) {
    throw new Error(
      `rpc/context.ts compares 'action' against a bare string literal ` +
        `(matched: ${JSON.stringify(bareComparison[0])}). Action names referenced here must come ` +
        'from a list in actions.ts so they can be checked against ALL_RPC_ACTIONS; a bare literal ' +
        'is exactly how the dangling cancelAccountDeletion exemption shipped unnoticed.'
    );
  }

  if (!code.includes('PENDING_DELETION_EXEMPT_ACTIONS')) {
    throw new Error(
      'rpc/context.ts no longer references PENDING_DELETION_EXEMPT_ACTIONS. If the exemption ' +
        'moved, move this guard with it — otherwise the first test above guards a list nothing reads.'
    );
  }

  if (!/allowPendingDeletion:\s*PENDING_DELETION_EXEMPT_ACTIONS\.includes\(\s*action\s*\)/.test(code)) {
    throw new Error(
      "rpc/context.ts does not derive `allowPendingDeletion` from " +
        'PENDING_DELETION_EXEMPT_ACTIONS.includes(action). Keep that wiring so the exempt-action ' +
        'list stays the single, testable source of truth for who may act while pending deletion.'
    );
  }
});
