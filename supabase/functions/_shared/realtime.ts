/// <reference path="./edge-runtime.d.ts" />

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const ORDERS_REALTIME_TOPIC = 'orders';
export const RIDERS_REALTIME_TOPIC = 'dispatch-riders';
export const RESTAURANTS_REALTIME_TOPIC = 'restaurants';
export const REALTIME_CHANGED_EVENT = 'changed';

export const orderRealtimeTopic = (orderId: string) => `order-${orderId}`;

type RealtimeMessage = {
  topic: string;
  event?: string;
  payload?: Record<string, unknown>;
};

// Broadcasts are best-effort refresh signals for the apps; a failed broadcast
// must never fail the mutation that triggered it, so errors are only logged.
export const broadcastRealtimeMessages = async (messages: RealtimeMessage[]) => {
  if (!supabaseUrl || !serviceRoleKey || messages.length === 0) {
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: messages.map((message) => ({
          event: message.event ?? REALTIME_CHANGED_EVENT,
          payload: message.payload ?? {},
          topic: message.topic,
        })),
      }),
    });

    if (!response.ok) {
      console.error('Realtime broadcast failed.', response.status, await response.text());
    }
  } catch (error) {
    console.error('Realtime broadcast failed.', error);
  }
};

export const broadcastOrderChanged = (orderId: string, payload: Record<string, unknown> = {}) =>
  broadcastRealtimeMessages([
    { payload: { orderId, ...payload }, topic: orderRealtimeTopic(orderId) },
    { payload: { orderId, ...payload }, topic: ORDERS_REALTIME_TOPIC },
  ]);

export const broadcastRidersChanged = (payload: Record<string, unknown> = {}) =>
  broadcastRealtimeMessages([{ payload, topic: RIDERS_REALTIME_TOPIC }]);

export const broadcastRestaurantsChanged = (payload: Record<string, unknown> = {}) =>
  broadcastRealtimeMessages([{ payload, topic: RESTAURANTS_REALTIME_TOPIC }]);
