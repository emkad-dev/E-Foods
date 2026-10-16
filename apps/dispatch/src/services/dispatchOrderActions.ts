import { callDispatchBackendRpc } from './backendRpc';

export const assignDispatchCourier = async (
  orderId: string,
  courier: {
    id: string;
    name: string;
  },
  _assignment: {
    courierId?: string | null;
    courierName?: string | null;
    dispatchId?: string | null;
    dispatchOwnerId?: string | null;
  } | null
) => {
  await callDispatchBackendRpc('dispatchAssignOrderCourier', {
    courierId: courier.id,
    orderId,
  });
};

const updateDispatchOrderStatus = async (orderId: string, action: string, deliveryCode?: string) => {
  await callDispatchBackendRpc('dispatchUpdateOrderStatus', {
    action,
    orderId,
    // Only the `delivered` action carries a code; omitted entirely for every
    // other action so their payloads are unchanged.
    ...(deliveryCode !== undefined ? { deliveryCode } : {}),
  });
};

export const markDispatchOrderPickedUp = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'picked_up');

export const markDispatchOrderOnTheWay = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'on_the_way');

// The server rejects `delivered` without the customer's 4-digit delivery code
// (400 when wrong or missing, 429 once locked after repeated wrong tries).
export const markDispatchOrderDelivered = async (
  orderId: string,
  _timeline: Record<string, unknown> | null,
  deliveryCode: string
) => updateDispatchOrderStatus(orderId, 'delivered', deliveryCode);

export const markDispatchOrderFailed = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'failed_delivery');

export const escalateDispatchOrder = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'escalate');

// Delivery offers (Task 10 / D2). Both calls are one-shot: the backend decides
// the outcome under a row lock, so there is nothing for the client to check
// first and nothing worth retrying automatically - a retry after a win would
// just be told "already accepted", and after a loss the offer is gone.

export const acceptDispatchOffer = async (offerId: string) =>
  callDispatchBackendRpc('dispatchAcceptOffer', { offerId });

export const declineDispatchOffer = async (offerId: string) =>
  callDispatchBackendRpc('dispatchDeclineOffer', { offerId });
