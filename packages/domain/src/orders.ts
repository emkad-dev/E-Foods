export const FULFILLMENT_TYPES = ['delivery', 'pickup'] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const PAYMENT_METHODS = [
  'cash',
  'card',
  'wallet',
  'bank_transfer',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CHECKOUT_PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'wallet'] as const;
export type CheckoutPaymentMethod = (typeof CHECKOUT_PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'authorized', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// Flat per-item marketplace markup added on top of the restaurant's menu price for
// the customer. MUST stay in sync with CUSTOMER_ITEM_MARKUP in the app-rpc Edge
// Function (the server re-derives the charge authoritatively).
export const CUSTOMER_ITEM_MARKUP = 150;

export const toCustomerFacingItemPrice = (basePrice: number | null | undefined): number => {
  const base = typeof basePrice === 'number' && Number.isFinite(basePrice) ? basePrice : 0;
  return base + CUSTOMER_ITEM_MARKUP;
};

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
  'escalated',
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
    case 'escalated':
      return '#b45309';
    default:
      return '#999999';
  }
};

export const isTerminalOrderStatus = (status: string | null | undefined): boolean => {
  const normalizedStatus = normalizeOrderStatus(status);
  return ['delivered', 'cancelled', 'rejected', 'failed_delivery'].includes(normalizedStatus);
};

export const formatPaymentMethodLabel = (method: string | null | undefined) => {
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'card':
      return 'Card';
    case 'wallet':
      return 'Wallet';
    case 'bank_transfer':
      return 'Bank transfer';
    default:
      return method ? method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, ' ') : 'Payment';
  }
};

export const isPrepaidPaymentMethod = (method: string | null | undefined) => {
  return ['card', 'wallet', 'bank_transfer'].includes(method ?? '');
};

export const formatPaymentStatusLabel = (status: string | null | undefined, method?: string | null) => {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'pending':
      return isPrepaidPaymentMethod(method) ? 'Awaiting confirmation' : 'Pending collection';
    case 'authorized':
      return 'Authorized';
    case 'failed':
      return 'Payment failed';
    case 'refunded':
      return 'Refunded';
    default:
      return status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ') : 'Unknown';
  }
};

export const canCustomerCancelOrder = (status: string | null | undefined) => {
  const normalizedStatus = normalizeOrderStatus(status);
  return ['placed', 'accepted', 'preparing', 'ready_for_pickup'].includes(normalizedStatus);
};

export const getCustomerRefundPolicyLabel = (status: string | null | undefined) => {
  const normalizedStatus = normalizeOrderStatus(status);

  if (['placed', 'accepted'].includes(normalizedStatus)) {
    return 'Full refund';
  }

  if (['preparing', 'ready_for_pickup'].includes(normalizedStatus)) {
    return '50% refund';
  }

  if (['picked_up', 'on_the_way'].includes(normalizedStatus)) {
    return 'Not cancellable';
  }
};
