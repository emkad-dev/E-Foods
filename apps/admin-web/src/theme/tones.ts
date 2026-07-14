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

  if (['confirmed', 'accepted', 'preparing'].includes(normalizedStatus)) {
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

export const getPaymentTone = (status?: string | null): AdminTone => {
  switch ((status ?? '').toLowerCase()) {
    case 'paid':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
      return 'warning';
    case 'authorized':
      return 'primary';
    case 'refunded':
      return 'info';
    default:
      return 'neutral';
  }
};

const STATUS_CHART_COLORS: Record<string, string> = {
  confirmed: '#2e7d32',
  placed: '#f57c00',
  cancelled: '#c54a43',
  delivered: '#1b5e20',
};

const PAYMENT_CHART_COLORS: Record<string, string> = {
  paid: '#2e7d32',
  pending: '#f57c00',
  failed: '#c54a43',
  authorized: '#117c6a',
  refunded: '#5b6978',
};

const FALLBACK_CHART_COLORS = ['#66bb6a', '#ffb74d', '#117c6a', '#5b6978', '#ef6c00', '#a5d6a7'];

export const getStatusChartColor = (status: string, index: number) =>
  STATUS_CHART_COLORS[status.toLowerCase()] ?? FALLBACK_CHART_COLORS[index % FALLBACK_CHART_COLORS.length];

export const getPaymentChartColor = (status: string, index: number) =>
  PAYMENT_CHART_COLORS[status.toLowerCase()] ?? FALLBACK_CHART_COLORS[index % FALLBACK_CHART_COLORS.length];

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
