import { serviceClient } from '../_shared/client.ts';
import { enqueueNotification } from '../_shared/queue.ts';
import type { OrderPlacementJob } from '../_shared/queue.ts';
import { getIdempotencyRecord, storeIdempotencyRecord } from '../_shared/idempotency.ts';
import {
  buildNotificationData,
  loadRestaurantRecipientUserIds,
} from '../_shared/notifications.ts';
import { broadcastOrderChanged } from '../_shared/realtime.ts';

const ORDER_STATUS = {
  PLACED: 'placed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};

type OrderPlacementResult = {
  success: boolean;
  orderId: string;
  status: string;
};

/**
 * Place an order from a queue job.
 *
 * This handler is intentionally idempotent and does NOT manage its own queue row
 * lifecycle — the queue-drainer owns finalization (completed / pending / failed).
 * On success it returns a result; on failure it throws and lets the drainer
 * decide whether to retry or mark the job failed.
 *
 * Idempotency is what allows the drainer to safely reclaim stale `processing`
 * jobs (visibility timeout): re-running an already-completed job must not place a
 * second order. We guard on two levels:
 *   1. An IdempotencyRecord keyed on the order id (authoritative "already done").
 *   2. An existence check on CustomerOrder, covering a crash that happened after
 *      the order was written but before the idempotency record was stored.
 */
export const handleOrderPlacement = async (job: OrderPlacementJob): Promise<OrderPlacementResult> => {
  const { orderId, customerId, restaurantId, items } = job;
  const idempotencyKey = `order_placement:${orderId}`;

  const existingRecord = await getIdempotencyRecord(serviceClient, idempotencyKey);
  if (existingRecord?.response) {
    return existingRecord.response as OrderPlacementResult;
  }

  const { data: existingOrder, error: existingError } = await serviceClient
    .from('CustomerOrder')
    .select('id,status,timeline')
    .eq('id', orderId)
    .maybeSingle<{ id: string; status: string | null; timeline: Record<string, unknown> | null }>();

  if (existingError) {
    throw new Error(`Failed to check existing order: ${existingError.message}`);
  }

  let timeline: Record<string, unknown> = existingOrder?.timeline ?? {};

  // Only create the order (and fire its one-time side effects) if it does not
  // already exist. A reclaimed job that previously got partway through skips
  // straight to the idempotent confirmation step below.
  if (!existingOrder) {
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
    timeline = (orderData?.timeline as Record<string, unknown> | null) ?? {};

    const itemsInsert = items.map((item) => ({
      orderId,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      specialInstructions: item.specialInstructions || null,
    }));

    const { error: itemsError } = await serviceClient.from('OrderItem').insert(itemsInsert);

    if (itemsError) {
      await serviceClient.from('CustomerOrder').delete().eq('id', orderId);
      throw new Error(`Failed to create order items: ${itemsError.message}`);
    }

    const { error: eventError } = await serviceClient.from('DeliveryEvent').insert({
      orderId,
      eventType: 'order_placed',
      timestamp: new Date().toISOString(),
      details: { source: 'queue' },
    });

    if (eventError) console.warn(`Failed to log event: ${eventError.message}`);

    const restaurantUsers = await loadRestaurantRecipientUserIds(restaurantId);
    if (restaurantUsers.length > 0) {
      await enqueueNotification(serviceClient, {
        userIds: restaurantUsers,
        payload: {
          title: 'New Order Received',
          body: `Order ${orderId} is waiting for confirmation`,
          data: buildNotificationData({
            app: 'partner',
            orderId,
            routeKey: 'partner_order_detail',
            type: 'order_update',
          }),
        },
      });
    }
  }

  await serviceClient
    .from('CustomerOrder')
    .update({
      // Keep the order 'placed' (awaiting restaurant acceptance) — only stamp the
      // confirmation time. 'confirmed' is not a valid order status and normalized to
      // 'draft', which disabled the partner's kitchen actions.
      status: ORDER_STATUS.PLACED,
      timeline: {
        ...timeline,
        confirmedAt: new Date().toISOString(),
      },
    })
    .eq('id', orderId);

  await broadcastOrderChanged(orderId, { restaurantId });

  const response: OrderPlacementResult = {
    success: true,
    orderId,
    status: ORDER_STATUS.PLACED,
  };

  await storeIdempotencyRecord(serviceClient, idempotencyKey, 'order_placement', customerId, response);

  return response;
};
