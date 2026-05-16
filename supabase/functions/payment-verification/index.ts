import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';
import { enqueueNotification, updateJobStatus, incrementRetry } from '../_shared/queue.ts';
import { PaymentVerificationJob } from '../_shared/queue.ts';
import {
  sendPushNotificationsToUsers,
  loadRestaurantRecipientUserIds,
} from '../_shared/notifications.ts';

const verifyPaystackTransaction = async (reference: string) => {
  const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!paystackSecretKey) throw new Error('PAYSTACK_SECRET_KEY not configured');

  const response = await fetch('https://api.paystack.co/transaction/verify/' + reference, {
    headers: {
      Authorization: `Bearer ${paystackSecretKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Paystack verification failed: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.status !== true) {
    throw new Error(`Payment verification failed: ${data.message}`);
  }

  return data.data;
};

const handlePaymentVerification = async (job: PaymentVerificationJob) => {
  const { orderId, paymentReference } = job;

  try {
    // Get order
    const { data: order, error: orderError } = await serviceClient
      .from('CustomerOrder')
      .select('*, restaurant:restaurantId(id)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) throw new Error('Order not found');

    // Verify payment with Paystack
    const paystackData = await verifyPaystackTransaction(paymentReference);

    // Validate amount (convert to kobo for comparison)
    const expectedAmount = order.pricing?.total ? Math.round(order.pricing.total * 100) : 0;
    if (paystackData.amount !== expectedAmount) {
      throw new Error(
        `Amount mismatch: expected ${expectedAmount}, got ${paystackData.amount}`
      );
    }

    // Update order with payment info
    const { error: updateError } = await serviceClient
      .from('CustomerOrder')
      .update({
        status: 'confirmed',
        payment: {
          status: 'success',
          reference: paymentReference,
          paystackResponse: paystackData,
          verifiedAt: new Date().toISOString(),
        },
        timeline: {
          ...order.timeline,
          paidAt: new Date().toISOString(),
        },
      })
      .eq('id', orderId);

    if (updateError) throw new Error(`Failed to update order: ${updateError.message}`);

    // Send notification to restaurant
    const restaurantUsers = await loadRestaurantRecipientUserIds(order.restaurantId);
    if (restaurantUsers.length > 0) {
      await enqueueNotification(serviceClient, {
        userIds: restaurantUsers,
        payload: {
          title: 'Paid Order Received',
          body: `Order ${orderId} has been paid and is ready for confirmation`,
          data: { orderId, type: 'payment_confirmed', path: `/orders/${orderId}` },
        },
      });
    }

    await updateJobStatus(serviceClient, 'payment-verification', orderId, 'completed', {
      orderId,
      status: 'confirmed',
      paymentStatus: 'success',
    });

    return { success: true, orderId, paymentStatus: 'success' };
  } catch (error: any) {
    console.error('Payment verification error:', error.message);

    // Attempt retry (payment is critical, so 5 retries)
    const canRetry = await incrementRetry(serviceClient, 'payment-verification', orderId, 5);
    if (canRetry) {
      await updateJobStatus(serviceClient, 'payment-verification', orderId, 'pending');
      throw new Error(`Payment verification failed, will retry: ${error.message}`);
    }

    // Mark order payment as failed
    await serviceClient
      .from('CustomerOrder')
      .update({
        payment: {
          status: 'failed',
          reference: job.paymentReference,
          error: error.message,
          failedAt: new Date().toISOString(),
        },
      })
      .eq('id', orderId);

    await updateJobStatus(
      serviceClient,
      'payment-verification',
      orderId,
      'failed',
      undefined,
      error.message
    );

    throw error;
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const job: PaymentVerificationJob = await req.json();
    const result = await handlePaymentVerification(job);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
