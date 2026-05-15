import { callPartnerBackendRpc } from './backendRpc';

const updatePartnerOrderStatus = async (orderId: string, action: string) => {
  await callPartnerBackendRpc('partnerUpdateOrderStatus', {
    action,
    orderId,
  });
};

export const acceptPartnerOrder = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updatePartnerOrderStatus(orderId, 'accept');

export const markPartnerOrderPreparing = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updatePartnerOrderStatus(orderId, 'preparing');

export const markPartnerOrderReady = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updatePartnerOrderStatus(orderId, 'ready');

export const rejectPartnerOrder = async (orderId: string, _timeline: Record<string, unknown> | null) =>
  updatePartnerOrderStatus(orderId, 'reject');
