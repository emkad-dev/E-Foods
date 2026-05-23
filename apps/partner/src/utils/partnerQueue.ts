import type { OrderDocument } from '../domain/entities';
import { normalizeOrderStatus } from '../domain/orders';
import { partnerTheme } from '../theme/palette';

type QueueTone = 'danger' | 'warning' | 'accent' | 'success' | 'muted';

export type KitchenSignal = {
  label: string;
  tone: QueueTone;
};

export const formatPartnerMoney = (amount: number) => `₦${amount.toFixed(2)}`;

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

const getKitchenPriority = (order: OrderDocument) => {
  const status = normalizeOrderStatus(order.status);

  if (status === 'placed') {
    return 0;
  }

  if (status === 'accepted') {
    return 1;
  }

  if (status === 'preparing') {
    return 2;
  }

  if (status === 'ready_for_pickup') {
    return 3;
  }

  if (['picked_up', 'on_the_way'].includes(status)) {
    return 4;
  }

  return 5;
};

export const sortLiveKitchenOrders = (orders: OrderDocument[]) =>
  [...orders].sort((left, right) => {
    const priorityDelta = getKitchenPriority(left) - getKitchenPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return toTimestamp(left.createdAt) - toTimestamp(right.createdAt);
  });

export const sortKitchenHistoryOrders = (orders: OrderDocument[]) =>
  [...orders].sort((left, right) => toTimestamp(right.updatedAt ?? right.createdAt) - toTimestamp(left.updatedAt ?? left.createdAt));

export const getKitchenHistoryBucket = (order: OrderDocument) => {
  const status = normalizeOrderStatus(order.status);

  if (status === 'delivered') {
    return 'delivered' as const;
  }

  if (status === 'failed_delivery') {
    return 'failed' as const;
  }

  return 'cancelled' as const;
};

export const getKitchenSignal = (order: OrderDocument): KitchenSignal => {
  const status = normalizeOrderStatus(order.status);

  if (status === 'placed') {
    return { label: 'New', tone: 'danger' };
  }

  if (status === 'accepted') {
    return { label: 'Waiting start', tone: 'warning' };
  }

  if (status === 'preparing') {
    return { label: 'Cooking', tone: 'accent' };
  }

  if (status === 'ready_for_pickup') {
    return { label: 'Pickup waiting', tone: 'warning' };
  }

  if (['picked_up', 'on_the_way'].includes(status)) {
    return { label: 'Handed off', tone: 'success' };
  }

  if (status === 'delivered') {
    return { label: 'Delivered', tone: 'success' };
  }

  if (status === 'failed_delivery') {
    return { label: 'Failed', tone: 'danger' };
  }

  if (['cancelled', 'rejected'].includes(status)) {
    return { label: 'Cancelled', tone: 'muted' };
  }

  return { label: 'Monitoring', tone: 'muted' };
};

export const getKitchenSignalColors = (tone: QueueTone) => {
  switch (tone) {
    case 'danger':
      return { backgroundColor: partnerTheme.dangerSoft, textColor: partnerTheme.danger };
    case 'warning':
      return { backgroundColor: partnerTheme.warningSoft, textColor: partnerTheme.warning };
    case 'accent':
      return { backgroundColor: partnerTheme.heroSoft, textColor: partnerTheme.accentStrong };
    case 'success':
      return { backgroundColor: partnerTheme.successSoft, textColor: partnerTheme.success };
    default:
      return { backgroundColor: partnerTheme.surfaceMuted, textColor: partnerTheme.textMuted };
  }
};

export const getKitchenElapsedLabel = (value: unknown) => {
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
