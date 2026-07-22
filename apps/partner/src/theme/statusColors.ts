import { normalizeOrderStatus } from '../domain/orders';
import { partnerTheme } from './palette';

// FEASTY brand status colors, aligned with the admin hub conventions.
// The shared packages/domain getOrderStatusColor stays untouched because the
// customer and dispatch apps still depend on its palette.
export const getPartnerStatusColor = (status: string | null | undefined): string => {
  switch (normalizeOrderStatus(status)) {
    case 'placed':
      return partnerTheme.brandOrange;
    case 'accepted':
    case 'preparing':
      return partnerTheme.brandGreen;
    case 'ready_for_pickup':
    case 'picked_up':
    case 'on_the_way':
      return '#117c6a';
    case 'delivered':
      return partnerTheme.success;
    case 'cancelled':
    case 'rejected':
    case 'failed_delivery':
      return partnerTheme.danger;
    case 'escalated':
      return partnerTheme.warning;
    default:
      return partnerTheme.textMuted;
  }
};
