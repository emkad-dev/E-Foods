// Request context and role resolution for app RPC.
//
// Holds the three things every action needs before its own logic runs: the
// authenticated caller, the role gate, and the backpressure classification for
// the hot write actions.

import { verifySupabaseJwt } from '../auth.ts';
import { loadUserAccount, upsertUserAccount } from '../accounts.ts';
import {
  getAuthenticatedRequestContext,
  type AuthenticatedRequestContext,
} from '../request-context.ts';
import { PENDING_DELETION_EXEMPT_ACTIONS } from './actions.ts';
import { nowIso } from './coercion.ts';
import type { RpcDispatcher } from './registry.ts';
import { fail } from './respond.ts';

export { getAuthenticatedRequestContext };
export type { AuthenticatedRequestContext };

/**
 * Writes that contend for the same rows (order creation and payment state) and
 * are therefore run behind a concurrency limiter. Both the set and the
 * per-action limits are load-bearing: they are what keeps a checkout stampede
 * from exhausting the function's connection budget.
 */
export const HOT_WRITE_ACTIONS = new Set([
  'placeCustomerOrder',
  'initializeCustomerPayment',
  'refreshCustomerPaymentStatus',
  'cancelCustomerOrder',
]);

export const HOT_WRITE_BACKPRESSURE_LIMITS: Record<string, number> = {
  cancelCustomerOrder: 8,
  initializeCustomerPayment: 8,
  placeCustomerOrder: 6,
  refreshCustomerPaymentStatus: 10,
};

export const ensureRole = (role: string, allowedRoles: readonly string[]) => {
  if (!allowedRoles.includes(role)) {
    fail(403, 'You do not have permission to perform this action.');
  }
};

const extractClaimText = (claims: Record<string, unknown>, key: string) =>
  typeof claims[key] === 'string' && claims[key].trim() ? claims[key].trim() : null;

/**
 * Context for the first-admin bootstrap, which cannot use the normal
 * authenticated context: the caller has no `user_profiles` row yet, so this
 * creates the account row from the JWT claims instead of refusing the request.
 */
export const getBootstrapRequestContext = async (request: Request) => {
  const { claims, token } = await verifySupabaseJwt(request);
  const uid = extractClaimText(claims as Record<string, unknown>, 'sub');
  const email = extractClaimText(claims as Record<string, unknown>, 'email')?.toLowerCase();
  const role = extractClaimText(claims as Record<string, unknown>, 'user_role') ?? 'customer';

  if (!uid || !email) {
    fail(401, 'Authenticated bootstrap request is missing a valid user identity.');
  }

  const existingAccount = await loadUserAccount(uid);
  if (!existingAccount) {
    const now = nowIso();
    await upsertUserAccount({
      uid,
      email,
      displayName: email.split('@')[0],
      emailVerified: true,
      roleDisplay: role,
      accountDisabled: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    email,
    role,
    token,
    uid,
    userProfile: {
      accountDisabled: false,
      email,
      role,
      uid,
    },
  };
};

/**
 * Turns a dispatcher into the callable the HTTP entrypoint uses.
 *
 * The ordering here reproduces the flat `if (action === …)` chain it replaced:
 * the two anonymous actions run before any auth, and *everything else* —
 * including an action nobody registered — authenticates first. That is why an
 * unauthenticated request for an unknown action answers 401, not 501.
 * A `null` return means "no handler", which the entrypoint turns into 501.
 */
export const createRpcDispatch =
  (dispatcher: RpcDispatcher<AuthenticatedRequestContext>) =>
  async (
    action: string,
    request: Request,
    data: Record<string, unknown>
  ): Promise<Response | null> => {
    const anonymousHandler = dispatcher.findAnonymousHandler(action);
    if (anonymousHandler) {
      return await anonymousHandler({ data, request });
    }

    // Actions exempt from the pending-deletion refusal. The list is currently
    // EMPTY: there is no restore path, because nothing in this repository ever
    // puts an account into the pending-deletion state (FEASTY ships immediate
    // deletion via `deleteOwnAccount`). Every action is therefore refused by
    // assertAccountAccessible if `deletionRequestedAt` is ever set.
    //
    // This used to read `action === 'cancelAccountDeletion'` — a name with no
    // entry in any action list and no handler, i.e. a promise of a way out
    // that did not exist. See PENDING_DELETION_EXEMPT_ACTIONS in actions.ts
    // and docs/account-deletion-design.md before adding anything here.
    const context = await getAuthenticatedRequestContext(request, {
      allowPendingDeletion: PENDING_DELETION_EXEMPT_ACTIONS.includes(action),
    });
    const handler = dispatcher.findHandler(action);

    if (!handler) {
      return null;
    }

    return await handler({ context, data, request });
  };
