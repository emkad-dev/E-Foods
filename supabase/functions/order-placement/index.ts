import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';
import { enqueueNotification, updateJobStatus, incrementRetry } from '../_shared/queue.ts';
import { OrderPlacementJob } from '../_shared/queue.ts';
import {
  sendPushNotificationsToUsers,
  loadRestaurantRecipientUserIds,
} from '../_shared/notifications.ts';

const ORDER_STATUS = {
  PLACED: 'placed',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};

const handleOrderPlacement = async (job: OrderPlacementJob) => {
  const { orderId, customerId, restaurantId, items } = job;

  try {
    // Insert order
    const { data: orderData, error: orderError } = await serviceClient
      .from('CustomerOrder')
      .insert({
        id: orderId,
        customerId,
        restaurantId,
        status: ORDER_STATUS.PLACED,
        timeline: {
          placedAt: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (orderError) throw new Error(`Failed to create order: ${orderError.message}`);

    // Insert items
    const itemsInsert = items.map((item) => ({
      orderId,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      specialInstructions: item.specialInstructions || null,
    }));

    const { error: itemsError } = await serviceClient
      .from('OrderItem')
      .insert(itemsInsert);

    if (itemsError) {
      // Rollback: delete order if items insert fails
      await serviceClient.from('CustomerOrder').delete().eq('id', orderId);
      throw new Error(`Failed to create order items: ${itemsError.message}`);
    }

    // Insert delivery event
    const { error: eventError } = await serviceClient.from('DeliveryEvent').insert({
      orderId,
      eventType: 'order_placed',
      timestamp: new Date().toISOString(),
      details: { source: 'queue' },
    });

    if (eventError) console.warn(`Failed to log event: ${eventError.message}`);

    // Enqueue notification
    const restaurantUsers = await loadRestaurantRecipientUserIds(restaurantId);
    if (restaurantUsers.length > 0) {
      await enqueueNotification(serviceClient, {
        userIds: restaurantUsers,
        payload: {
          title: 'New Order Received',
          body: `Order ${orderId} is waiting for confirmation`,
          data: { orderId, type: 'order_update', path: `/orders/${orderId}` },
        },
      });
    }

    // Update order status to confirmed
    await serviceClient
      .from('CustomerOrder')
      .update({
        status: ORDER_STATUS.CONFIRMED,
        timeline: {
          ...orderData?.timeline,
          confirmedAt: new Date().toISOString(),
        },
      })
      .eq('id', orderId);

    await updateJobStatus(serviceClient, 'order-placement', orderId, 'completed', {
      orderId,
      status: ORDER_STATUS.CONFIRMED,
    });

    return { success: true, orderId, status: ORDER_STATUS.CONFIRMED };
  } catch (error: any) {
    console.error('Order placement error:', error.message);

    // Attempt retry
    const canRetry = await incrementRetry(serviceClient, 'order-placement', orderId, 3);
    if (canRetry) {
      await updateJobStatus(serviceClient, 'order-placement', orderId, 'pending');
      throw new Error(`Order placement failed, will retry: ${error.message}`);
    }

    await updateJobStatus(
      serviceClient,
      'order-placement',
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
    const job: OrderPlacementJob = await req.json();
    const result = await handleOrderPlacement(job);
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
