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

Deno.serve(async (req) => {
  const observation = createEdgeObservation(req, 'order-placement');

  if (req.method === 'OPTIONS') {
    const response = new Response('ok', { headers: corsHeaders });
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
