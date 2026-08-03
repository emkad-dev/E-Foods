// Shared HTTP entrypoint body for every RPC-dispatching Edge Function.
//
// app-rpc and the five domain-scoped functions (feasty-orders,
// feasty-dispatch, feasty-partner, feasty-admin, feasty-account) are all just
// "wire HTTP to a dispatcher" — parse the action, apply backpressure to the
// hot writes, dispatch, shape the response, observe. That body used to live
// only in app-rpc/index.ts; lifting it here means each entrypoint is a
// handful of lines (import its domain(s), build a dispatcher, call
// `serveRpcFunction`) instead of six near-identical copies of this file.
//
// Nothing here is domain-specific: `createRpcHttpHandler` takes the calling
// function's own name (used for observability logs and the backpressure key
// prefix, so each function's logs and concurrency accounting are attributable
// to it) and an already-built dispatcher.

import { corsHeaders } from '../cors.ts';
import {
  createEdgeObservation,
  finishEdgeObservation,
  runWithBackpressure,
} from '../observability.ts';
import { sanitizeText } from './coercion.ts';
import {
  HOT_WRITE_ACTIONS,
  HOT_WRITE_BACKPRESSURE_LIMITS,
  createRpcDispatch,
  type AuthenticatedRequestContext,
} from './context.ts';
import type { RpcDispatcher } from './registry.ts';
import { errorResponse, json } from './respond.ts';

/**
 * Builds the `(request) => Promise<Response>` fetch handler for an RPC
 * function. Exported separately from `serveRpcFunction` (which calls
 * `Deno.serve` on it) so tests can invoke the handler directly without
 * starting a server.
 */
export const createRpcHttpHandler = (
  functionName: string,
  dispatcher: RpcDispatcher<AuthenticatedRequestContext>
) => {
  const dispatchRpcAction = createRpcDispatch(dispatcher);

  return async (request: Request): Promise<Response> => {
    const observation = createEdgeObservation(request, functionName);
    let response: Response | undefined;
    let capturedError: unknown = null;

    if (request.method === 'OPTIONS') {
      // A 204 response must not carry a body — Deno throws a TypeError otherwise,
      // which crashed the CORS preflight once gateway JWT verification was disabled.
      response = new Response(null, {
        headers: corsHeaders,
        status: 204,
      });
      finishEdgeObservation(observation, { status: response.status });
      return response;
    }

    if (request.method !== 'POST') {
      response = json(405, {
        error: {
          message: 'Use POST for app RPC requests.',
        },
      });
      finishEdgeObservation(observation, { status: response.status });
      return response;
    }

    let payload: { action?: string; data?: Record<string, unknown> } = {};

    try {
      payload = (await request.json().catch(() => ({}))) as typeof payload;
      const action = sanitizeText(payload.action);
      observation.action = action || undefined;

      if (!action) {
        response = json(400, {
          error: {
            message: 'An RPC action is required.',
          },
        });
        return response;
      }

      const executeAction = async () => {
        const nativeResponse = await dispatchRpcAction(action, request, payload.data ?? {});
        return (
          nativeResponse ??
          json(501, {
            error: {
              message: `The RPC action "${action}" is not implemented in the native Supabase backend.`,
            },
          })
        );
      };

      response = HOT_WRITE_ACTIONS.has(action)
        ? await runWithBackpressure(
            `${functionName}:${action}`,
            {
              maxConcurrent: HOT_WRITE_BACKPRESSURE_LIMITS[action] ?? 8,
              retryAfterSeconds: 3,
            },
            executeAction
          )
        : await executeAction();

      return response;
    } catch (error) {
      capturedError = error;
      response = errorResponse(error);
      return response;
    } finally {
      finishEdgeObservation(observation, {
        error: capturedError ?? undefined,
        status: response?.status ?? 500,
      });
    }
  };
};

/** Builds the handler and hands it to `Deno.serve` — the entrypoint's entire job. */
export const serveRpcFunction = (
  functionName: string,
  dispatcher: RpcDispatcher<AuthenticatedRequestContext>
) => {
  Deno.serve(createRpcHttpHandler(functionName, dispatcher));
};
