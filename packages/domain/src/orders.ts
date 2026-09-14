export const FULFILLMENT_TYPES = ['delivery', 'pickup'] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const PAYMENT_METHODS = [
  'cash',
  'card',
  'wallet',
  'bank_transfer',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CHECKOUT_PAYMENT_METHODS = ['card', 'bank_transfer', 'wallet'] as const;
export type CheckoutPaymentMethod = (typeof CHECKOUT_PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'authorized', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = [
  'draft',
  // Task 18 (G2): a paid scheduled order awaiting release into the kitchen. Not
  // terminal; the kitchen board shows it in its own lane, not "New".
  'scheduled',
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
  // 'confirmed' was written by the async order/payment handlers but is not a valid
  // OrderStatus; map it to 'placed' so existing paid orders stay actionable.
  confirmed: 'placed',
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

// Pickup orders end at "ready for pickup" — the customer collects in person, so the
// tracking timeline must not show a "Delivered" step.
export const PICKUP_TRACKING_STEPS: OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
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
    case 'scheduled':
      return 'Scheduled';
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

/**
 * FILL ONLY. These are saturated signal hues for a tint, a dot or a bar segment —
 * never a text colour.
 *
 * Measured on the surfaces the five call sites actually used them on, the failures
 * were the rule rather than the exception:
 *   as text on `${color}20` over a light card  10 of 11 branches fail
 *     (`placed` #f5b342 at 1.67:1, `default` #999999 at 2.50:1)
 *   as text on the customer badge's green tint  9 of 11 fail (#f5b342, 1.64:1)
 *   as bare text on a light card                7 of 11 fail (#f5b342, 1.79:1)
 *   as text on `${color}20` over the dark hero  5 of 11 fail (#5D3FD3, 2.51:1)
 * Darkening the hues cannot fix the tint cases — the background darkens with them.
 * So every call site now follows the rule `Badge` encodes: the fill carries the
 * status hue, the label is a plain legible foreground.
 *
 * The values are deliberately unchanged; only how they are consumed changed.
 */
export const getOrderStatusColor = (status: string | null | undefined): string => {
  const normalizedStatus = normalizeOrderStatus(status);

  switch (normalizedStatus) {
    case 'scheduled':
      return '#8b5cf6';
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
  // Once the kitchen starts preparing, the order can no longer be self-cancelled.
  // A 'scheduled' order (Task 18 / G2) is pre-kitchen, so it is cancellable too
  // (full refund — the kitchen never engaged).
  const normalizedStatus = normalizeOrderStatus(status);
  return ['scheduled', 'placed', 'accepted'].includes(normalizedStatus);
};

export const getCustomerRefundPolicyLabel = (status: string | null | undefined) => {
  const normalizedStatus = normalizeOrderStatus(status);

  if (['scheduled', 'placed', 'accepted'].includes(normalizedStatus)) {
    return 'Full refund';
  }

  if (['preparing', 'ready_for_pickup'].includes(normalizedStatus)) {
    return '50% refund';
  }

  if (['picked_up', 'on_the_way'].includes(normalizedStatus)) {
    return 'Not cancellable';
  }
};
