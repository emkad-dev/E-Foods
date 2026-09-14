// Explicit `.ts` specifiers, the convention documented in
// `packages/design-system/src/tokens/index.ts`: `dispatchQueue.test.ts` guards
// `getDispatchSignalColors` by loading this module under
// `node --test --experimental-strip-types`, and Node's ESM resolver will not
// infer an extension. Metro and tsc both resolve the explicit path unchanged.
import type { OrderDocument } from '../domain/entities.ts';
import { normalizeOrderStatus } from '../domain/orders.ts';
import { dispatchTheme } from '../theme/palette.ts';

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
        // Rendered as the chip's `color`. On `dangerSoft` the fill red measures
        // 3.74:1 — the worst text contrast in the app, and on the one chip whose
        // whole job is to be read first.
        textColor: dispatchTheme.dangerText,
      };
    case 'warning':
      return {
        backgroundColor: dispatchTheme.warningSoft,
        // `warningText`, matching partner's `getKitchenSignalColors` and the
        // `dangerText` line above. The fill orange is 2.13:1 on `warningSoft` —
        // the worst reading in either queue, and this branch carries the two
        // chips ("New order", "Pickup risk") a dispatcher is meant to spot first.
        textColor: dispatchTheme.warningText,
      };
    case 'accent':
      return {
        backgroundColor: dispatchTheme.accentTint,
        textColor: dispatchTheme.accentStrong,
      };
    case 'success':
      return {
        backgroundColor: dispatchTheme.successSoft,
        // The brand green is a fill too: #2e7d32 on `successSoft` (#c8e6c9) is
        // 3.81:1. There is no `successText` counterpart, and none is needed —
        // `Badge`'s own `success` tone is already `successSoft` + `text.primary`,
        // so this branch takes the pairing the design system had settled.
        textColor: dispatchTheme.text,
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
