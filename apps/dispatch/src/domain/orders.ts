export const LEGACY_ORDER_STATUS_MAP = {
  pending: 'placed',
  preparing: 'preparing',
  ready: 'ready_for_pickup',
  delivered: 'delivered',
} as const;

export const normalizeOrderStatus = (status: string | null | undefined) => {
  if (!status) {
    return 'draft';
  }

  if (status in LEGACY_ORDER_STATUS_MAP) {
    return LEGACY_ORDER_STATUS_MAP[status as keyof typeof LEGACY_ORDER_STATUS_MAP];
  }

  return status;
};

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
  switch (normalizeOrderStatus(status)) {
    case 'placed':
      return '#f59e0b';
    case 'accepted':
      return '#2563eb';
    case 'preparing':
      return '#7c3aed';
    case 'ready_for_pickup':
      return '#0f9d58';
    case 'picked_up':
      return '#0891b2';
    case 'on_the_way':
      return '#ea580c';
    case 'delivered':
      return '#16a34a';
    case 'cancelled':
    case 'rejected':
    case 'failed_delivery':
      return '#dc2626';
    default:
      return '#64748b';
  }
};

export const isTerminalOrderStatus = (status: string | null | undefined): boolean => {
  return ['delivered', 'cancelled', 'rejected', 'failed_delivery'].includes(normalizeOrderStatus(status));
};
