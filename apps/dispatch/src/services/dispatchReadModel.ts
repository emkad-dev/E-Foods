import type { DispatchProfileDocument, OrderDocument } from '../domain/entities';
import { callDispatchBackendRpc } from './backendRpc';

type DispatchOrderDetail = OrderDocument & {
  events?: {
    actorUid?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    eventType: string;
    id: string;
    note?: string | null;
  }[];
};

export const getDispatchDeliveryQueue = async () =>
  callDispatchBackendRpc<{ orders: OrderDocument[] }>('dispatchGetDeliveryQueue');

export const getDispatchRiders = async () =>
  callDispatchBackendRpc<{ riders: DispatchProfileDocument[] }>('dispatchGetRiders');

export const getDispatchOrderDetail = async (orderId: string) =>
  callDispatchBackendRpc<{ order: DispatchOrderDetail }>('dispatchGetOrderDetail', { orderId });
