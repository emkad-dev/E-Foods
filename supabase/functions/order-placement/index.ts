/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import {
  createEdgeObservation,
  finishEdgeObservation,
  isEdgeBackpressureError,
  jsonResponse,
  runWithBackpressure,
} from '../_shared/observability.ts';
import type { OrderPlacementJob } from '../_shared/queue.ts';
import { handleOrderPlacement } from './handler.ts';

// verify_jwt = true (supabase/config.toml) only proves the caller sent *a*
// valid project JWT - the public anon key satisfies that and ships in
// plaintext in every client bundle, so it does not prove the caller is the
// queue-drainer. Nothing in this codebase calls this HTTP endpoint: real
// traffic reaches handleOrderPlacement via queue-drainer's direct import
// (supabase/functions/queue-drainer/index.ts). Without this check, anyone
// could POST a body that deserializes into OrderPlacementJob and get a
// CustomerOrder row written under the service-role client with an
// attacker-chosen customerId and items. Same fail-closed pattern as
// broadcast-runner and queue-drainer's assertWorkerAccess: reject unless the
// caller presents the same shared secret the queue-drainer uses, and reject
// unconditionally if that secret isn't configured at all.
const WORKER_TOKEN = Deno.env.get('QUEUE_WORKER_TOKEN')?.trim() ?? '';

Deno.serve(async (req) => {
  const observation = createEdgeObservation(req, 'order-placement');

  if (req.method === 'OPTIONS') {
    const response = new Response('ok', { headers: corsHeaders });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  const token = req.headers.get('x-queue-worker-token')?.trim() ?? '';
  if (!WORKER_TOKEN || token !== WORKER_TOKEN) {
    const response = jsonResponse(401, { error: { message: 'Unauthorized' } }, corsHeaders);
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  try {
    const job: OrderPlacementJob = await req.json();
    const result = await runWithBackpressure('order-placement', { maxConcurrent: 4, retryAfterSeconds: 3 }, async () =>
      handleOrderPlacement(job)
    );
    const response = jsonResponse(200, result, corsHeaders);
    finishEdgeObservation(observation, { status: response.status });
    return response;
  } catch (error: any) {
    const response = jsonResponse(
      isEdgeBackpressureError(error) ? 429 : 500,
      {
        error: error.message,
      },
      {
        ...corsHeaders,
        ...(isEdgeBackpressureError(error)
          ? { 'Retry-After': String(error.retryAfterSeconds) }
          : {}),
      }
    );
    finishEdgeObservation(observation, { status: response.status, error });
    return response;
  }
});
