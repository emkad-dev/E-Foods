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

/**
 * A live delivery offer (Task 10 / D2). Carried alongside `orders` rather than
 * inside it: an offered order has no assignment yet, so it is nobody's order
 * until somebody accepts and is invisible to the queue's ownership filter.
 */
export type DispatchDeliveryOffer = {
  courierId: string;
  id: string;
  offeredAt: string | null;
  order: OrderDocument;
  orderId: string;
  respondedAt: string | null;
  respondsBy: string;
  sequence: number | null;
  status: string;
};

export const getDispatchDeliveryQueue = async () =>
  callDispatchBackendRpc<{ offers?: DispatchDeliveryOffer[]; orders: OrderDocument[] }>(
    'dispatchGetDeliveryQueue'
  );

export const getDispatchRiders = async () =>
  callDispatchBackendRpc<{ riders: DispatchProfileDocument[] }>('dispatchGetRiders');

export const getDispatchOrderDetail = async (orderId: string) =>
  callDispatchBackendRpc<{ order: DispatchOrderDetail }>('dispatchGetOrderDetail', { orderId });

export type WeeklyEarningsRecord = {
  address?: string | null;
  amount: number;
  deliveredAt?: string | null;
  orderId: string;
  restaurantName?: string | null;
};

export type WeeklyEarningsReport = {
  averagePerDelivery: number;
  currency: string;
  deliveredOrders: number;
  records: WeeklyEarningsRecord[];
  total: number;
  week: {
    endsAt: string;
    startsAt: string;
    timezone: string;
  };
};

export const getDispatchWeeklyEarnings = async () =>
  callDispatchBackendRpc<WeeklyEarningsReport>('dispatchGetWeeklyEarnings');
