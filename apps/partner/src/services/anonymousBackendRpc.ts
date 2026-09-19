import { backendRpcErrorFromResponse } from '../../../../packages/auth/src';
import { KNOWN_RPC_TARGETS, resolveRpcMode, resolveRpcTarget } from '../../../../packages/domain/src/rpcRoutes';
import { deriveRpcFunctionUrl } from '../../../../packages/domain/src/rpcUrl';
import { appEnv, supabaseEnv } from '../config/env';
import { supabase } from './supabase/config';

/**
 * The backend RPC call for the handful of actions that are reachable WITHOUT a
 * session (`ANONYMOUS_ACTIONS` in supabase/functions/_shared/rpc/actions.ts).
 *
 * WHY `callPartnerBackendRpc` CANNOT BE USED FOR THESE. It resolves a session
 * first and throws `SESSION_EXPIRED_ERROR_MESSAGE` before making any network
 * call when there is none. For an authenticated action that is exactly right.
 * For `staffInviteResolve` -- whose entire purpose is to answer a person who
 * has no account yet, and may be about to find out they need one -- it turns
 * the normal case into "your session expired", which is both wrong and
 * unactionable.
 *
 * WHY THE ANON KEY IS THE BEARER even if a session happens to exist. These
 * actions are decided entirely by the email and the code in the body; the
 * server reads no identity off the token. Sending a stale or half-expired
 * access token can only add a way for the call to fail, so it is left out.
 * (Contrast `redeemStaffInvite`, which is bound to the signed-in account and
 * must go through the authenticated helper.)
 *
 * Errors surface exactly as they do on the authenticated path: a non-OK
 * response becomes a `BackendRpcError` whose `.message` is the sentence the
 * server wrote. Callers must render that verbatim -- the staff-invite
 * rejection is deliberately one message for wrong, expired, unknown and
 * exhausted, and any attempt to be more specific turns this endpoint into an
 * oracle for which addresses have live invites.
 */
export const callAnonymousBackendRpc = async <T>(action: string, data: Record<string, unknown>): Promise<T> => {
  // Resolved the same way `callBackendRpc` does, so this deliberately separate
  // transport follows the split/legacy kill switch instead of drifting from it.
  const targetFunction = resolveRpcTarget(action, resolveRpcMode(appEnv.rpcMode));
  const payload = { action, data };
  const anonKey = supabaseEnv.anonKey?.trim();

  const unwrap = (body: unknown): T =>
    body && typeof body === 'object' && 'data' in body ? ((body as { data: T }).data) : (body as T);

  const backendRpcUrl = appEnv.backendRpcUrl?.trim();

  if (backendRpcUrl && anonKey) {
    try {
      const targetUrl = deriveRpcFunctionUrl(backendRpcUrl, targetFunction, KNOWN_RPC_TARGETS);
      const response = await fetch(targetUrl, {
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
        method: 'POST',
      });

      if (!response.ok) {
        // A RESPONSE IS AN ANSWER. Thrown out of the try and NOT retried via
        // the relay below: the relay reaches the same function and would fail
        // identically, so a retry buys a second billed invocation, a slower
        // error, and nothing else. Only a transport failure falls through.
        throw await backendRpcErrorFromResponse(response, action);
      }

      return unwrap(await response.json().catch(() => null));
    } catch (error) {
      if (error instanceof Error && error.name === 'BackendRpcError') {
        throw error;
      }

      console.warn(`Anonymous RPC ${action} direct URL transport failure, retrying via relay:`, error);
    }
  }

  // The relay. supabase-js attaches the anon key when there is no session,
  // which is the state every caller of this helper is in.
  const { data: responseData, error } = await supabase.functions.invoke<T>(targetFunction, { body: payload });

  if (error) {
    const response = (error as { context?: unknown }).context;

    if (response instanceof Response) {
      throw await backendRpcErrorFromResponse(response, action);
    }

    throw new Error(error instanceof Error ? error.message : `Backend RPC ${action} failed.`);
  }

  return unwrap(responseData);
};
