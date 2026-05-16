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
  status: 'pending' | 'processing' | 'completed' | 'failed',
  result?: Record<string, unknown>,
  error?: string
) => {
  const tableName = `queue_${queue.replace('-', '_')}`;
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

  await client
    .from(tableName)
    .update({ retry_count: newRetryCount })
    .eq('id', jobId);

  return true;
};
