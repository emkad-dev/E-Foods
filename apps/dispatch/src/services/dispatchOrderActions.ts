import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

const dispatchAssignOrderCourier = httpsCallable(functions, 'dispatchAssignOrderCourier');
const dispatchUpdateOrderStatus = httpsCallable(functions, 'dispatchUpdateOrderStatus');

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
  await dispatchAssignOrderCourier({
    courierId: courier.id,
    orderId,
  });
};

export const markDispatchOrderPickedUp = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await dispatchUpdateOrderStatus({
    action: 'picked_up',
    orderId,
  });
};

export const markDispatchOrderOnTheWay = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await dispatchUpdateOrderStatus({
    action: 'on_the_way',
    orderId,
  });
};

export const markDispatchOrderDelivered = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await dispatchUpdateOrderStatus({
    action: 'delivered',
    orderId,
  });
};

export const markDispatchOrderFailed = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await dispatchUpdateOrderStatus({
    action: 'failed_delivery',
    orderId,
  });
};

export const escalateDispatchOrder = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await dispatchUpdateOrderStatus({
    action: 'escalate',
    orderId,
  });
};
