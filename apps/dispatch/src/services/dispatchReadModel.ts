import { httpsCallable } from 'firebase/functions';
import type { DispatchProfileDocument, OrderDocument } from '../domain/entities';
import { functions } from './firebase/config';

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

const dispatchGetDeliveryQueueCallable = httpsCallable<Record<string, never>, { orders: OrderDocument[] }>(
  functions,
  'dispatchGetDeliveryQueue'
);

const dispatchGetRidersCallable = httpsCallable<Record<string, never>, { riders: DispatchProfileDocument[] }>(
  functions,
  'dispatchGetRiders'
);

const dispatchGetOrderDetailCallable = httpsCallable<{ orderId: string }, { order: DispatchOrderDetail }>(
  functions,
  'dispatchGetOrderDetail'
);

export const getDispatchDeliveryQueue = async () => {
  const result = await dispatchGetDeliveryQueueCallable({});
  return result.data;
};

export const getDispatchRiders = async () => {
  const result = await dispatchGetRidersCallable({});
  return result.data;
};

export const getDispatchOrderDetail = async (orderId: string) => {
  const result = await dispatchGetOrderDetailCallable({ orderId });
  return result.data;
};
