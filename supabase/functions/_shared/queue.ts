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

export const enqueueNotification = async (
  client: SupabaseClient,
  job: NotificationJob
) => {
  const jobId = `notif:${Date.now()}`;
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

  const delayMs = Math.min(
    RETRY_BACKOFF_BASE_MS * 2 ** (newRetryCount - 1),
    RETRY_BACKOFF_MAX_MS
  );
  const availableAt = new Date(Date.now() + delayMs).toISOString();

  await client
    .from(tableName)
    .update({ retry_count: newRetryCount, available_at: availableAt })
    .eq('id', jobId);

  return true;
};

export const claimPendingQueueJobs = async <TPayload = unknown>(
  client: SupabaseClient,
  queue: string,
  limit = 10
) => {
  const tableName = queueTableName(queue);
  const now = new Date().toISOString();

  // Visibility timeout: reclaim jobs left `processing` by a crashed worker back
  // to `pending` so they can be retried. `available_at` is cleared so they are
  // immediately eligible. Safe only because handlers are idempotent — a job that
  // actually completed (but never finalized its row) becomes a no-op on re-run.
  const staleBefore = new Date(Date.now() - VISIBILITY_TIMEOUT_MS).toISOString();
  const { error: reclaimError } = await client
    .from(tableName)
    .update({ status: 'pending', updated_at: now, available_at: null })
    .eq('status', 'processing')
    .lt('updated_at', staleBefore);

  if (reclaimError) {
    console.error(`Failed to reclaim stale ${queue} queue jobs: ${reclaimError.message}`);
  }

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
