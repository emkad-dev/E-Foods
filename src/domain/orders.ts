export const FULFILLMENT_TYPES = ['delivery', 'pickup'] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const PAYMENT_METHODS = [
  'cash',
  'card',
  'wallet',
  'bank_transfer',
  'paypal',
  'apple_pay',
  'google_pay',
  'pos',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'authorized', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = [
  'draft',
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'on_the_way',
  'delivered',
  'cancelled',
  'rejected',
  'failed_delivery',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const LEGACY_ORDER_STATUS_MAP = {
  pending: 'placed',
  preparing: 'preparing',
  ready: 'ready_for_pickup',
  delivered: 'delivered',
} as const;

export type LegacyOrderStatus = keyof typeof LEGACY_ORDER_STATUS_MAP;
export type AnyKnownOrderStatus = OrderStatus | LegacyOrderStatus;

export const DELIVERY_TRACKING_STEPS: OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'on_the_way',
  'delivered',
];

export const PICKUP_TRACKING_STEPS: OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'delivered',
];

export const normalizeOrderStatus = (status: string | null | undefined): OrderStatus => {
  if (!status) {
    return 'draft';
  }

  if (status in LEGACY_ORDER_STATUS_MAP) {
    return LEGACY_ORDER_STATUS_MAP[status as LegacyOrderStatus];
  }

  if ((ORDER_STATUSES as readonly string[]).includes(status)) {
    return status as OrderStatus;
  }

  return 'draft';
};

export const getTrackingSteps = (fulfillmentType: FulfillmentType = 'delivery'): OrderStatus[] =>
  fulfillmentType === 'pickup' ? PICKUP_TRACKING_STEPS : DELIVERY_TRACKING_STEPS;

export const formatOrderStatusLabel = (status: string | null | undefined): string => {
  const normalizedStatus = normalizeOrderStatus(status);

  switch (normalizedStatus) {
    case 'ready_for_pickup':
      return 'Ready for pickup';
    case 'picked_up':
      return 'Picked up';
    case 'on_the_way':
      return 'On the way';
    case 'failed_delivery':
      return 'Delivery failed';
    default:
      return normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1).replace(/_/g, ' ');
  }
};

export const getOrderStatusColor = (status: string | null | undefined): string => {
  const normalizedStatus = normalizeOrderStatus(status);

  switch (normalizedStatus) {
    case 'placed':
      return '#f5b342';
    case 'accepted':
      return '#2563eb';
    case 'preparing':
      return '#5D3FD3';
    case 'ready_for_pickup':
      return '#0f9d58';
    case 'picked_up':
      return '#0ea5e9';
    case 'on_the_way':
      return '#f97316';
    case 'delivered':
      return '#16a34a';
    case 'cancelled':
    case 'rejected':
    case 'failed_delivery':
      return '#dc2626';
    default:
      return '#999999';
  }
};

export const isTerminalOrderStatus = (status: string | null | undefined): boolean => {
  const normalizedStatus = normalizeOrderStatus(status);
  return ['delivered', 'cancelled', 'rejected', 'failed_delivery'].includes(normalizedStatus);
};
