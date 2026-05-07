import { adminTheme } from './palette';

export type AdminTone = 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const getAdminToneColors = (tone: AdminTone) => {
  switch (tone) {
    case 'primary':
      return {
        backgroundColor: adminTheme.accentSoft,
        borderColor: '#bfdbfe',
        textColor: adminTheme.accentStrong,
      };
    case 'success':
      return {
        backgroundColor: adminTheme.successSoft,
        borderColor: '#bbf7d0',
        textColor: adminTheme.success,
      };
    case 'warning':
      return {
        backgroundColor: adminTheme.warningSoft,
        borderColor: '#fed7aa',
        textColor: adminTheme.warning,
      };
    case 'danger':
      return {
        backgroundColor: adminTheme.dangerSoft,
        borderColor: '#fecaca',
        textColor: adminTheme.danger,
      };
    case 'info':
      return {
        backgroundColor: adminTheme.infoSoft,
        borderColor: '#99f6e4',
        textColor: adminTheme.info,
      };
    case 'neutral':
    default:
      return {
        backgroundColor: adminTheme.surfaceMuted,
        borderColor: adminTheme.border,
        textColor: adminTheme.textSoft,
      };
  }
};

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
