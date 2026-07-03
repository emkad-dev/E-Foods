/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';
import {
  buildNotificationData,
  loadRestaurantRecipientUserIds,
  sendPushNotificationsToRoles,
  sendPushNotificationsToUsers,
} from '../_shared/notifications.ts';
import {
  claimPendingQueueJobs,
  incrementRetry,
  updateJobStatus,
  type NotificationJob,
  type OrderPlacementJob,
  type PaymentVerificationJob,
} from '../_shared/queue.ts';
import {
  createEdgeObservation,
  finishEdgeObservation,
  jsonResponse,
  runWithBackpressure,
} from '../_shared/observability.ts';
import { handleOrderPlacement } from '../order-placement/handler.ts';
import { handlePaymentVerification, markPaymentVerificationFailed } from '../payment-verification/handler.ts';

type JsonObject = Record<string, unknown>;
type QueueName = 'notifications' | 'order-placement' | 'payment-verification';
type QueueSelection = QueueName | 'all';

class QueueWorkerError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'QueueWorkerError';
    this.status = status;
  }
}

const WORKER_TOKEN = Deno.env.get('QUEUE_WORKER_TOKEN')?.trim() ?? '';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 4;

const sanitizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const chunkArray = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  jsonResponse(status, body, {
    ...corsHeaders,
    ...headers,
  });

const parseSelection = (value: unknown): QueueSelection => {
  const nextValue = sanitizeText(value, 'all').toLowerCase();
  return nextValue === 'order-placement' || nextValue === 'payment-verification' || nextValue === 'notifications'
    ? nextValue
    : 'all';
};

const assertWorkerAccess = (request: Request) => {
  if (!WORKER_TOKEN) {
    throw new QueueWorkerError(500, 'QUEUE_WORKER_TOKEN is not configured.');
  }

  const token = sanitizeText(request.headers.get('x-queue-worker-token'));
  if (!token || token !== WORKER_TOKEN) {
    throw new QueueWorkerError(403, 'Invalid queue worker token.');
  }
};

const processNotificationJob = async (job: NotificationJob) => {
  const title = sanitizeText(job.payload.title);
  const body = sanitizeText(job.payload.body);

  if (!title || !body) {
    throw new Error('Notification payload must include a title and body.');
  }

  let sent = 0;

  if (Array.isArray(job.userIds) && job.userIds.length > 0) {
    const result = await sendPushNotificationsToUsers(job.userIds, {
      body,
      data: job.payload.data ?? {},
      title,
    });
    sent += result.sent;
  }

  if (Array.isArray(job.roles) && job.roles.length > 0) {
    const result = await sendPushNotificationsToRoles(job.roles, {
      body,
      data: job.payload.data ?? {},
      title,
    });
    sent += result.sent;
  }

  const restaurantId = sanitizeText(job.restaurantId);
  if (restaurantId) {
    const recipientUserIds = await loadRestaurantRecipientUserIds(restaurantId);
    if (recipientUserIds.length > 0) {
      const result = await sendPushNotificationsToUsers(recipientUserIds, {
        body,
        data:
          job.payload.data ??
          buildNotificationData({
            app: 'partner',
            restaurantId,
            routeKey: 'partner_orders',
            type: 'queue_notification',
          }),
        title,
      });
      sent += result.sent;
    }
  }

  return { sent };
};

type QueueJob = JsonObject & { id: string; payload: unknown };

// All queues now finalize their row through the drainer. Handlers are pure and
// idempotent: they return a result on success and throw on failure, leaving the
// completed / pending(retry) / failed transitions to drainQueue below. This is
// what unblocks the visibility-timeout reclaim in claimPendingQueueJobs — a
// reclaimed-and-re-run job is a safe no-op because the handlers guard with
// IdempotencyRecord and order/payment status checks.
const queueDefinitions: Record<
  QueueName,
  {
    maxRetries: number;
    process: (job: QueueJob) => Promise<JsonObject>;
    onTerminalFailure?: (job: QueueJob, error: unknown) => Promise<void>;
  }
> = {
  'notifications': {
    maxRetries: 3,
    process: async (job) => processNotificationJob(job.payload as NotificationJob),
  },
  'order-placement': {
    maxRetries: 3,
    process: async (job) => handleOrderPlacement(job.payload as OrderPlacementJob),
  },
  'payment-verification': {
    maxRetries: 5,
    process: async (job) => handlePaymentVerification(job.payload as PaymentVerificationJob),
    onTerminalFailure: async (job, error) => {
      const payload = job.payload as PaymentVerificationJob;
      await markPaymentVerificationFailed(
        payload.orderId,
        payload.paymentReference,
        error instanceof Error ? error.message : 'Payment verification failed.'
      );
    },
  },
};

const drainQueue = async (queue: QueueName, batchSize: number, concurrency: number) => {
  const claimedJobs = await claimPendingQueueJobs(serviceClient, queue, batchSize);
  if (claimedJobs.length === 0) {
    return {
      claimed: 0,
      completed: 0,
      failed: 0,
      queue,
    };
  }

  const definition = queueDefinitions[queue];
  let completed = 0;
  let failed = 0;

  for (const batch of chunkArray(claimedJobs, concurrency)) {
    const results = await Promise.allSettled(
      batch.map(async (job) => {
        try {
          const result = await definition.process(job);
          await updateJobStatus(serviceClient, queue, job.id, 'completed', result);
          return { ok: true as const };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Queue job failed.';
          const canRetry = await incrementRetry(serviceClient, queue, job.id, definition.maxRetries);
          if (canRetry) {
            await updateJobStatus(serviceClient, queue, job.id, 'pending', undefined, message);
          } else {
            await updateJobStatus(serviceClient, queue, job.id, 'failed', undefined, message);
            if (definition.onTerminalFailure) {
              try {
                await definition.onTerminalFailure(job, error);
              } catch (hookError) {
                console.error(
                  `onTerminalFailure for ${queue} job ${job.id} failed:`,
                  hookError instanceof Error ? hookError.message : hookError
                );
              }
            }
          }

          return { ok: false as const, error };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.ok) {
        completed += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    claimed: claimedJobs.length,
    completed,
    failed,
    queue,
  };
};

Deno.serve(async (request) => {
  const observation = createEdgeObservation(request, 'queue-drainer');

  if (request.method === 'OPTIONS') {
    const response = new Response('ok', { headers: corsHeaders, status: 204 });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  if (request.method !== 'POST') {
    const response = json(405, {
      error: {
        message: 'Use POST for queue draining requests.',
      },
    });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  }

  try {
    assertWorkerAccess(request);

    const payload = (await request.json().catch(() => ({}))) as {
      batchSize?: number;
      concurrency?: number;
      queue?: QueueSelection;
    };

    const queueSelection = parseSelection(payload.queue);
    const batchSize = Number.isFinite(payload.batchSize) ? Math.max(1, Math.min(50, Math.floor(payload.batchSize ?? DEFAULT_BATCH_SIZE))) : DEFAULT_BATCH_SIZE;
    const concurrency = Number.isFinite(payload.concurrency) ? Math.max(1, Math.min(10, Math.floor(payload.concurrency ?? DEFAULT_CONCURRENCY))) : DEFAULT_CONCURRENCY;

    const queueNames: QueueName[] =
      queueSelection === 'all'
        ? ['order-placement', 'payment-verification', 'notifications']
        : [queueSelection];

    const results = await runWithBackpressure(
      'queue-drainer',
      {
        maxConcurrent: 1,
        retryAfterSeconds: 5,
      },
      async () => {
        const settled = [];
        for (const queueName of queueNames) {
          settled.push(await drainQueue(queueName, batchSize, concurrency));
        }
        return settled;
      }
    );

    const response = json(200, {
      data: {
        results,
      },
    });
    finishEdgeObservation(observation, { status: response.status });
    return response;
  } catch (error) {
    const status = error instanceof QueueWorkerError ? error.status : 500;
    const response = json(
      status,
      {
        error: {
          message: error instanceof Error ? error.message : 'Unexpected queue draining failure.',
        },
      },
      {}
    );
    finishEdgeObservation(observation, { status: response.status, error });
    return response;
  }
});
