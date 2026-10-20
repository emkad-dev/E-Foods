/// <reference path="../_shared/edge-runtime.d.ts" />

// rider-payouts: the scheduled batch that pays FEASTY riders their pending
// earnings (delivery pay + tips) by Paystack transfer. Invoked by pg_cron
// (20261020b_rider_payouts_schedule.sql) with the shared queue-worker token,
// the same way broadcast-runner is. All logic and every safety rule lives in
// _shared/riderPayouts.ts; this file only authenticates the caller.
//
// A no-op until the rider_auto_payouts FeatureFlag is turned on.

import { constantTimeEqual } from '../_shared/crypto.ts';
import { logEdgeEvent } from '../_shared/observability.ts';
import { buildDefaultRiderPayoutDeps, runRiderPayouts } from '../_shared/riderPayouts.ts';

const WORKER_TOKEN = Deno.env.get('QUEUE_WORKER_TOKEN')?.trim() ?? '';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json(405, { error: { message: 'Method not allowed' } });
  }

  const token = request.headers.get('x-queue-worker-token')?.trim() ?? '';
  if (!WORKER_TOKEN || !token || !constantTimeEqual(token, WORKER_TOKEN)) {
    return json(401, { error: { message: 'Unauthorized' } });
  }

  try {
    const summary = await runRiderPayouts(buildDefaultRiderPayoutDeps());
    logEdgeEvent('info', 'Rider payout run finished', summary as unknown as Record<string, unknown>);
    return json(200, { data: summary });
  } catch (error) {
    logEdgeEvent('error', 'Rider payout run failed', {
      error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
    });
    return json(500, { error: { message: 'Rider payout run failed' } });
  }
});
