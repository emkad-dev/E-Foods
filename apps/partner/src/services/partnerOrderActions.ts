import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase/config';

const getOrderRef = (orderId: string) => doc(db, 'orders', orderId);

export const acceptPartnerOrder = async (orderId: string, timeline: Record<string, unknown> | null) => {
  await updateDoc(getOrderRef(orderId), {
    status: 'accepted',
    timeline: {
      ...(timeline ?? {}),
      acceptedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
};

export const markPartnerOrderPreparing = async (orderId: string, timeline: Record<string, unknown> | null) => {
  await updateDoc(getOrderRef(orderId), {
    status: 'preparing',
    timeline: {
      ...(timeline ?? {}),
      preparingAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
};

export const markPartnerOrderReady = async (orderId: string, timeline: Record<string, unknown> | null) => {
  await updateDoc(getOrderRef(orderId), {
    status: 'ready_for_pickup',
    timeline: {
      ...(timeline ?? {}),
      readyAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
};

export const rejectPartnerOrder = async (orderId: string, timeline: Record<string, unknown> | null) => {
  await updateDoc(getOrderRef(orderId), {
    status: 'rejected',
    timeline: {
      ...(timeline ?? {}),
      cancelledAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
};
