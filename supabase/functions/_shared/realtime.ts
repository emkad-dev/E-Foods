/// <reference path="./edge-runtime.d.ts" />

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const ORDERS_REALTIME_TOPIC = 'orders';
export const RIDERS_REALTIME_TOPIC = 'dispatch-riders';
export const RESTAURANTS_REALTIME_TOPIC = 'restaurants';
export const PROMOS_REALTIME_TOPIC = 'promos';
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

// A distinct event on the SAME `order-<id>` topic the order-detail screen
// already knows about, carrying the rider's live position to the customer.
// The customer must NOT be able to read DispatchRiderPing (it stays RLS
// service-role-only, no policy), so this broadcast is the ONLY channel the
// rider's coordinates reach the customer through - and it carries ONLY the
// coordinates plus a coarse timestamp. Nothing that identifies the rider
// (id, phone, name, zone, vehicle), and nothing about any OTHER order.
export const RIDER_POSITION_EVENT = 'rider-position';

export type RiderPositionPayload = {
  latitude: number;
  longitude: number;
  updatedAt: string | null;
};

// The payload is built field-by-field from an explicit whitelist here, on
// purpose - never by spreading a rider row. This is the one place the shape
// the customer receives is defined, and adding a field here is the only way a
// field could ever leak; the payload-whitelist test asserts these three and
// only these three.
export const broadcastRiderPosition = (orderId: string, position: RiderPositionPayload) =>
  broadcastRealtimeMessages([
    {
      event: RIDER_POSITION_EVENT,
      payload: {
        latitude: position.latitude,
        longitude: position.longitude,
        updatedAt: position.updatedAt ?? null,
      },
      topic: orderRealtimeTopic(orderId),
    },
  ]);

export const broadcastRidersChanged = (payload: Record<string, unknown> = {}) =>
  broadcastRealtimeMessages([{ payload, topic: RIDERS_REALTIME_TOPIC }]);

export const broadcastRestaurantsChanged = (payload: Record<string, unknown> = {}) =>
  broadcastRealtimeMessages([{ payload, topic: RESTAURANTS_REALTIME_TOPIC }]);

export const broadcastPromosChanged = (payload: Record<string, unknown> = {}) =>
  broadcastRealtimeMessages([{ payload, topic: PROMOS_REALTIME_TOPIC }]);

export const SUPPORT_INBOX_TOPIC = 'support-inbox';
export const supportThreadTopic = (conversationId: string) => `support-${conversationId}`;

export const broadcastSupportInboxChanged = (payload: Record<string, unknown> = {}) =>
  broadcastRealtimeMessages([{ payload, topic: SUPPORT_INBOX_TOPIC }]);

export const broadcastSupportThreadChanged = (
  conversationId: string,
  payload: Record<string, unknown> = {}
) =>
  broadcastRealtimeMessages([
    { payload: { conversationId, ...payload }, topic: supportThreadTopic(conversationId) },
    { payload: { conversationId, ...payload }, topic: SUPPORT_INBOX_TOPIC },
  ]);
