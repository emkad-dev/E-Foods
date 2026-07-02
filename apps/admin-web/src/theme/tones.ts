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

const STATUS_CHART_COLORS: Record<string, string> = {
  confirmed: '#03b833',
  placed: '#ff951f',
  cancelled: '#c54a43',
  delivered: '#028a26',
};

const FALLBACK_CHART_COLORS = ['#7fd99a', '#ffc175', '#117c6a', '#5b6978', '#e07c00', '#b5e48c'];

export const getStatusChartColor = (status: string, index: number) =>
  STATUS_CHART_COLORS[status.toLowerCase()] ?? FALLBACK_CHART_COLORS[index % FALLBACK_CHART_COLORS.length];

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
