import type { OrderDocument } from '../domain/entities';
import { callCustomerBackendRpc } from './backendRpc';

export const getCustomerOrders = async () =>
  callCustomerBackendRpc<{ orders: OrderDocument[] }>('customerGetOrders');

export const getCustomerOrderDetail = async (orderId: string) =>
  callCustomerBackendRpc<{ order: OrderDocument }>('customerGetOrderDetail', { orderId });
