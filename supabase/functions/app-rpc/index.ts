/// <reference path="../_shared/edge-runtime.d.ts" />

// app-rpc — the single POST endpoint every FEASTY client talks to.
//
// This file does nothing but wire HTTP to the domain dispatcher: parse, apply
// backpressure to the hot writes, dispatch, and shape the response. All action
// logic lives in _shared/domains/*, so lifting a domain into its own Edge
// Function later is a matter of pointing a new entrypoint at its handler map.

import { corsHeaders } from '../_shared/cors.ts';
import { accountDomain } from '../_shared/domains/account.ts';
import { adminDomain } from '../_shared/domains/admin.ts';
import { dispatchDomain } from '../_shared/domains/dispatch.ts';
import { ordersDomain } from '../_shared/domains/orders.ts';
import { partnerDomain } from '../_shared/domains/partner.ts';
import {
  createEdgeObservation,
  finishEdgeObservation,
  runWithBackpressure,
} from '../_shared/observability.ts';
import { sanitizeText } from '../_shared/rpc/coercion.ts';
import {
  HOT_WRITE_ACTIONS,
  HOT_WRITE_BACKPRESSURE_LIMITS,
  createRpcDispatch,
} from '../_shared/rpc/context.ts';
import { buildDispatcher } from '../_shared/rpc/registry.ts';
import { errorResponse, json } from '../_shared/rpc/respond.ts';

const dispatcher = buildDispatcher([
  ordersDomain,
  dispatchDomain,
  partnerDomain,
  adminDomain,
  accountDomain,
]);

const dispatchRpcAction = createRpcDispatch(dispatcher);

Deno.serve(async (request) => {
  const observation = createEdgeObservation(request, 'app-rpc');
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
          `app-rpc:${action}`,
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
});
