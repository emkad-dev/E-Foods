/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import {
  createEdgeObservation,
  finishEdgeObservation,
  jsonResponse,
} from '../_shared/observability.ts';

Deno.serve(async (req) => {
  const observation = createEdgeObservation(req, 'payment-verification');
  if (req.method === 'OPTIONS') {
    const response = new Response('ok', { headers: corsHeaders });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  const response = jsonResponse(
    403,
    {
      error: 'Payment verification is only processed through the signed Paystack webhook.',
    },
    corsHeaders
  );
  finishEdgeObservation(observation, { status: response.status });
  return response;
});
