import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type OrderPlacementJob = {
  orderId: string;
  customerId: string;
  restaurantId: string;
  items: Array<{
    menuItemId: string;
    quantity: number;
    specialInstructions?: string;
  }>;
};

export type PaymentVerificationJob = {
  orderId: string;
  paymentReference: string;
};

export type NotificationJob = {
  userIds?: string[];
  roles?: string[];
  restaurantId?: string;
  payload: {
    title: string;
    body: string;
    data: Record<string, string>;
  };
};

export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type QueueJobRecord<TPayload = unknown> = {
  available_at?: string | null;
  created_at?: string | null;
  error?: string | null;
  id: string;
  payload: TPayload;
  result?: JsonObject | null;
  retry_count?: number | null;
  status: QueueStatus;
  updated_at?: string | null;
};

type JsonObject = Record<string, unknown>;

// A claimed job is marked `processing` and `updated_at` is stamped at claim
// time. An edge function invocation cannot outlive its wall-clock budget, so a
// `processing` row whose `updated_at` is older than this threshold belongs to a
// worker that crashed (or timed out) before finalizing — it is safe to reclaim
// back to `pending`. Re-running a reclaimed job is made safe by handler-level
// idempotency (IdempotencyRecord + order/payment status checks).
const VISIBILITY_TIMEOUT_MS = 180_000;

// Exponential backoff for retried jobs. `available_at` gates selection so a
// transiently failing job is deferred instead of hot-looping every drain tick.
const RETRY_BACKOFF_BASE_MS = 5_000;
const RETRY_BACKOFF_MAX_MS = 300_000;

export const retryBackoffMs = (retryCount: number) =>
  Math.min(RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, retryCount - 1), RETRY_BACKOFF_MAX_MS);

const queueTableName = (queue: string) => `queue_${queue.replace('-', '_')}`;

export const enqueueOrderPlacement = async (
  client: SupabaseClient,
  job: OrderPlacementJob
) => {
  const { error } = await client.from('queue_order_placement').insert({
    id: job.orderId,
    payload: job,
    status: 'pending',
    retry_count: 0,
    created_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to enqueue order placement: ${error.message}`);
  return { jobId: job.orderId, queue: 'order-placement' };
};

export const enqueuePaymentVerification = async (
  client: SupabaseClient,
  job: PaymentVerificationJob
) => {
  const jobId = `${job.orderId}:${Date.now()}`;
  const { error } = await client.from('queue_payment_verification').insert({
    id: jobId,
    payload: job,
    status: 'pending',
    retry_count: 0,
    created_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to enqueue payment verification: ${error.message}`);
  return { jobId, queue: 'payment-verification' };
};

/**
 * A deferred Expo receipt lookup, carried on the notifications queue so it
 * needs no new table or cron: the drainer already runs every minute and
 * `available_at` already defers a row. Expo recommends waiting ~15 minutes
 * before fetching receipts.
 */
export type PushReceiptCheckJob = {
  attempt?: number;
  kind: 'push_receipts';
  tickets: Array<{ id: string; token: string }>;
};

export const PUSH_RECEIPT_CHECK_DELAY_MS = 15 * 60_000;
/** First look plus one re-check for receipts Expo had not produced yet. */
export const PUSH_RECEIPT_CHECK_MAX_ATTEMPTS = 2;

export const isPushReceiptCheckJob = (payload: unknown): payload is PushReceiptCheckJob =>
  typeof payload === 'object' &&
  payload !== null &&
  (payload as { kind?: unknown }).kind === 'push_receipts' &&
  Array.isArray((payload as { tickets?: unknown }).tickets);

export const enqueuePushReceiptCheck = async (
  client: SupabaseClient,
  tickets: PushReceiptCheckJob['tickets'],
  delayMs = PUSH_RECEIPT_CHECK_DELAY_MS,
  attempt = 1
) => {
  if (tickets.length === 0) {
    return null;
  }

  const jobId = `receipts:${crypto.randomUUID()}`;
  const payload: PushReceiptCheckJob = { attempt, kind: 'push_receipts', tickets };
  const { error } = await client.from('queue_notifications').insert({
    id: jobId,
    payload,
    status: 'pending',
    retry_count: 0,
    available_at: new Date(Date.now() + delayMs).toISOString(),
    created_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to enqueue push receipt check: ${error.message}`);
  return { jobId, queue: 'notifications' };
};

export const enqueueNotification = async (
  client: SupabaseClient,
  job: NotificationJob
) => {
  // A bare `notif:${Date.now()}` id collided (primary-key violation, so the
  // enqueue threw and the notification was lost) whenever two notifications
  // were enqueued in the same millisecond - e.g. two restaurants in one
  // multi-store checkout.
  const jobId = `notif:${Date.now()}:${crypto.randomUUID()}`;
  const { error } = await client.from('queue_notifications').insert({
    id: jobId,
    payload: job,
    status: 'pending',
    retry_count: 0,
    created_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to enqueue notification: ${error.message}`);
  return { jobId, queue: 'notifications' };
};

export const updateJobStatus = async (
  client: SupabaseClient,
  queue: string,
  jobId: string,
  status: QueueStatus,
  result?: Record<string, unknown>,
  error?: string
) => {
  const tableName = queueTableName(queue);
  const { error: updateError } = await client
    .from(tableName)
    .update({
      status,
      result: result || null,
      error: error || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (updateError) console.error(`Failed to update job status: ${updateError.message}`);
};

export const incrementRetry = async (
  client: SupabaseClient,
  queue: string,
  jobId: string,
  maxRetries = 3
) => {
  const tableName = `queue_${queue.replace('-', '_')}`;
  const { data } = await client
    .from(tableName)
    .select('retry_count')
    .eq('id', jobId)
    .single();

  const newRetryCount = (data?.retry_count || 0) + 1;

  if (newRetryCount > maxRetries) {
    await updateJobStatus(client, queue, jobId, 'failed', undefined, 'Max retries exceeded');
    return false;
  }

  const availableAt = new Date(Date.now() + retryBackoffMs(newRetryCount)).toISOString();

  await client
    .from(tableName)
    .update({ retry_count: newRetryCount, available_at: availableAt })
    .eq('id', jobId);

  return true;
};

export type DeadLetteredJob = { id: string; queue: string; retryCount: number };

export type ClaimOptions = {
  /** Same cap the drainer applies to thrown failures. */
  maxRetries?: number;
  /** Called for each job dead-lettered by the visibility-timeout reclaim. */
  onDeadLetter?: (job: DeadLetteredJob) => Promise<void> | void;
};

const RECLAIM_BATCH_LIMIT = 50;

/**
 * Visibility timeout: a job left `processing` by a worker that crashed or hit
 * its wall-clock limit goes back to `pending` - and that COUNTS as an attempt.
 * It used to be reset without touching retry_count, so a job that reliably
 * outlived the worker (a hung upstream call) was re-run every 3 minutes
 * forever and never reached `failed`. Now it backs off like any other retry
 * and is dead-lettered (status `failed` + onDeadLetter) past maxRetries.
 *
 * Each row moves with a compare-and-swap on (status, updated_at), so two
 * overlapping drainers cannot both count the same timeout.
 */
export const reclaimStaleQueueJobs = async (
  client: SupabaseClient,
  queue: string,
  options: ClaimOptions = {},
  nowMs = Date.now()
) => {
  const tableName = queueTableName(queue);
  const maxRetries = options.maxRetries ?? 3;
  const nowIso = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - VISIBILITY_TIMEOUT_MS).toISOString();

  const { data: staleRows, error: staleError } = await client
    .from(tableName)
    .select('id,retry_count,updated_at')
    .eq('status', 'processing')
    .lt('updated_at', staleBefore)
    .limit(RECLAIM_BATCH_LIMIT);

  if (staleError) {
    console.error(`Failed to load stale ${queue} queue jobs: ${staleError.message}`);
    return { deadLettered: 0, reclaimed: 0 };
  }

  let reclaimed = 0;
  let deadLettered = 0;

  for (const row of (staleRows ?? []) as Array<{ id: string; retry_count?: number | null; updated_at?: string | null }>) {
    const retryCount = (row.retry_count ?? 0) + 1;
    const exhausted = retryCount > maxRetries;
    const update = exhausted
      ? {
          error: `Worker timed out ${retryCount} times (visibility timeout); dead-lettered.`,
          retry_count: retryCount,
          status: 'failed',
          updated_at: nowIso,
        }
      : {
          available_at: new Date(nowMs + retryBackoffMs(retryCount)).toISOString(),
          retry_count: retryCount,
          status: 'pending',
          updated_at: nowIso,
        };

    let query = client.from(tableName).update(update).eq('id', row.id).eq('status', 'processing');
    if (row.updated_at) {
      query = query.eq('updated_at', row.updated_at);
    }
    const { data: moved, error: moveError } = await query.select('id');

    if (moveError) {
      console.error(`Failed to reclaim ${queue} queue job ${row.id}: ${moveError.message}`);
      continue;
    }
    if (!Array.isArray(moved) || moved.length === 0) {
      continue; // another drainer got there first
    }

    if (exhausted) {
      deadLettered += 1;
      try {
        await options.onDeadLetter?.({ id: row.id, queue, retryCount });
      } catch (hookError) {
        console.error(`onDeadLetter for ${queue} job ${row.id} failed:`, hookError);
      }
    } else {
      reclaimed += 1;
    }
  }

  return { deadLettered, reclaimed };
};

export const claimPendingQueueJobs = async <TPayload = unknown>(
  client: SupabaseClient,
  queue: string,
  limit = 10,
  options: ClaimOptions = {}
) => {
  const tableName = queueTableName(queue);
  const now = new Date().toISOString();

  await reclaimStaleQueueJobs(client, queue, options);

  const { data, error } = await client
    .from(tableName)
    .select('id,payload,status,retry_count,created_at,updated_at,available_at,result,error')
    .eq('status', 'pending')
    .or(`available_at.is.null,available_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load ${queue} queue jobs: ${error.message}`);
  }

  const claimedJobs: QueueJobRecord<TPayload>[] = [];

  for (const row of (data ?? []) as QueueJobRecord<TPayload>[]) {
    const { data: claimed, error: claimError } = await client
      .from(tableName)
      .update({
        status: 'processing',
        updated_at: now,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id,payload,status,retry_count,created_at,updated_at,available_at,result,error')
      .maybeSingle<QueueJobRecord<TPayload>>();

    if (claimError) {
      throw new Error(`Failed to claim ${queue} queue job ${row.id}: ${claimError.message}`);
    }

    if (claimed) {
      claimedJobs.push(claimed);
    }
  }

  return claimedJobs;
};

export const finalizeQueueJob = async (
  client: SupabaseClient,
  queue: string,
  jobId: string,
  status: Exclude<QueueStatus, 'pending' | 'processing'>,
  result?: JsonObject,
  error?: string
) => {
  await updateJobStatus(client, queue, jobId, status, result, error);
};
