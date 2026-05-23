import type { OrderDocument } from '../domain/entities';
import { normalizeOrderStatus } from '../domain/orders';
import { dispatchTheme } from '../theme/palette';

type QueueSignalTone = 'danger' | 'warning' | 'accent' | 'success' | 'muted';

export type QueueSignal = {
  label: string;
  tone: QueueSignalTone;
};

export const formatDispatchMoney = (amount: number) => `₦${amount.toFixed(2)}`;

const toTimestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

const getLiveQueuePriority = (order: OrderDocument) => {
  const status = normalizeOrderStatus(order.status);
  const hasCourier = Boolean(order.assignment?.courierId);

  if (status === 'escalated') {
    return 0;
  }

  if (!hasCourier && ['accepted', 'preparing', 'ready_for_pickup'].includes(status)) {
    return 1;
  }

  if (!hasCourier && status === 'placed') {
    return 2;
  }

  if (hasCourier && ['accepted', 'preparing', 'ready_for_pickup'].includes(status)) {
    return 3;
  }

  if (['picked_up', 'on_the_way'].includes(status)) {
    return 4;
  }

  return 5;
};

export const sortLiveDispatchOrders = (orders: OrderDocument[]) =>
  [...orders].sort((left, right) => {
    const priorityDelta = getLiveQueuePriority(left) - getLiveQueuePriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return toTimestamp(left.createdAt) - toTimestamp(right.createdAt);
  });

export const sortDispatchHistoryOrders = (orders: OrderDocument[]) =>
  [...orders].sort((left, right) => {
    return toTimestamp(right.updatedAt ?? right.createdAt) - toTimestamp(left.updatedAt ?? left.createdAt);
  });

export const getDispatchAssignmentLabel = (order: OrderDocument) => order.assignment?.courierName?.trim() || 'Unassigned';

export const getDispatchQueueSignal = (order: OrderDocument): QueueSignal => {
  const status = normalizeOrderStatus(order.status);
  const hasCourier = Boolean(order.assignment?.courierId);

  if (status === 'escalated') {
    return { label: 'Escalated', tone: 'danger' };
  }

  if (!hasCourier && ['accepted', 'preparing', 'ready_for_pickup'].includes(status)) {
    return { label: 'Needs rider', tone: 'danger' };
  }

  if (!hasCourier && status === 'placed') {
    return { label: 'New order', tone: 'warning' };
  }

  if (hasCourier && ['accepted', 'preparing', 'ready_for_pickup'].includes(status)) {
    return { label: 'Pickup risk', tone: 'warning' };
  }

  if (['picked_up', 'on_the_way'].includes(status)) {
    return { label: 'In transit', tone: 'accent' };
  }

  if (status === 'delivered') {
    return { label: 'Delivered', tone: 'success' };
  }

  if (['cancelled', 'rejected'].includes(status)) {
    return { label: 'Cancelled', tone: 'muted' };
  }

  if (status === 'failed_delivery') {
    return { label: 'Failed', tone: 'danger' };
  }

  return { label: 'Monitoring', tone: 'muted' };
};

export const getDispatchSignalColors = (tone: QueueSignalTone) => {
  switch (tone) {
    case 'danger':
      return {
        backgroundColor: dispatchTheme.dangerSoft,
        textColor: dispatchTheme.danger,
      };
    case 'warning':
      return {
        backgroundColor: dispatchTheme.warningSoft,
        textColor: dispatchTheme.warning,
      };
    case 'accent':
      return {
        backgroundColor: dispatchTheme.accentTint,
        textColor: dispatchTheme.accentStrong,
      };
    case 'success':
      return {
        backgroundColor: dispatchTheme.successSoft,
        textColor: dispatchTheme.success,
      };
    default:
      return {
        backgroundColor: dispatchTheme.surfaceMuted,
        textColor: dispatchTheme.textMuted,
      };
  }
};

export const getDispatchElapsedLabel = (value: unknown) => {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return 'Time unavailable';
  }

  const deltaMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (deltaMinutes < 60) {
    return `${deltaMinutes} min open`;
  }

  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  return minutes === 0 ? `${hours} hr open` : `${hours} hr ${minutes} min open`;
};

export const getDispatchHistoryBucket = (order: OrderDocument) => {
  const status = normalizeOrderStatus(order.status);

  if (status === 'delivered') {
    return 'delivered' as const;
  }

  if (status === 'failed_delivery') {
    return 'failed' as const;
  }

  return 'cancelled' as const;
};
