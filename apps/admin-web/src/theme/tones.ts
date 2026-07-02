export type AdminTone = 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const getApprovalTone = (approvalStatus?: string | null, isPublished?: boolean | null): AdminTone => {
  const normalizedStatus = (approvalStatus ?? '').toLowerCase();

  if (normalizedStatus === 'approved' || isPublished === true) {
    return 'success';
  }

  if (normalizedStatus === 'unpublished') {
    return 'neutral';
  }

  return 'warning';
};

export const getOrderTone = (status?: string | null): AdminTone => {
  const normalizedStatus = (status ?? '').toLowerCase();

  if (['delivered'].includes(normalizedStatus)) {
    return 'success';
  }

  if (['cancelled', 'failed_delivery', 'rejected'].includes(normalizedStatus)) {
    return 'danger';
  }

  if (['ready_for_pickup', 'picked_up', 'on_the_way'].includes(normalizedStatus)) {
    return 'info';
  }

  if (['accepted', 'preparing'].includes(normalizedStatus)) {
    return 'primary';
  }

  return 'warning';
};

export const getRoleTone = (role?: string | null): AdminTone => {
  switch ((role ?? '').toLowerCase()) {
    case 'admin':
      return 'danger';
    case 'restaurant':
      return 'primary';
    case 'dispatch':
      return 'info';
    case 'customer':
    default:
      return 'neutral';
  }
};

export const getApplicationTone = (status?: string | null): AdminTone => {
  switch ((status ?? '').toLowerCase()) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'warning';
  }
};
