import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

const partnerUpdateOrderStatus = httpsCallable(functions, 'partnerUpdateOrderStatus');

export const acceptPartnerOrder = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await partnerUpdateOrderStatus({
    action: 'accept',
    orderId,
  });
};

export const markPartnerOrderPreparing = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await partnerUpdateOrderStatus({
    action: 'preparing',
    orderId,
  });
};

export const markPartnerOrderReady = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await partnerUpdateOrderStatus({
    action: 'ready',
    orderId,
  });
};

export const rejectPartnerOrder = async (orderId: string, _timeline: Record<string, unknown> | null) => {
  await partnerUpdateOrderStatus({
    action: 'reject',
    orderId,
  });
};
