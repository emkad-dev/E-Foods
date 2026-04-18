import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase/config';

const getOrderRef = (orderId: string) => doc(db, 'orders', orderId);

export const acceptDispatchOrder = async (orderId: string, timeline: Record<string, unknown> | null) => {
  await updateDoc(getOrderRef(orderId), {
    status: 'accepted',
    timeline: {
      ...(timeline ?? {}),
      acceptedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
};

export const assignDispatchCourier = async (
  orderId: string,
  courier: {
    id: string;
    name: string;
  },
  assignment: {
    courierId?: string | null;
    courierName?: string | null;
    dispatchId?: string | null;
  } | null
) => {
  await updateDoc(getOrderRef(orderId), {
    assignment: {
      ...(assignment ?? {}),
      courierId: courier.id,
      courierName: courier.name,
      dispatchId: 'dispatch-alpha',
    },
    updatedAt: serverTimestamp(),
  });
};

export const markDispatchOrderPickedUp = async (orderId: string, timeline: Record<string, unknown> | null) => {
  await updateDoc(getOrderRef(orderId), {
    status: 'picked_up',
    timeline: {
      ...(timeline ?? {}),
      pickedUpAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
};

export const markDispatchOrderDelivered = async (orderId: string, timeline: Record<string, unknown> | null) => {
  await updateDoc(getOrderRef(orderId), {
    status: 'delivered',
    timeline: {
      ...(timeline ?? {}),
      deliveredAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
};
