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
  } | null
) => {
  await callDispatchBackendRpc('dispatchAssignOrderCourier', {
    courierId: courier.id,
    orderId,
  });
};

const updateDispatchOrderStatus = async (orderId: string, action: string) => {
  await callDispatchBackendRpc('dispatchUpdateOrderStatus', {
    action,
    orderId,
  });
};

export const markDispatchOrderPickedUp = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'picked_up');

export const markDispatchOrderOnTheWay = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'on_the_way');

export const markDispatchOrderDelivered = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'delivered');

export const markDispatchOrderFailed = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'failed_delivery');

export const escalateDispatchOrder = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updateDispatchOrderStatus(orderId, 'escalate');
