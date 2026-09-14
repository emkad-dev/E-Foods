import { normalizeOrderStatus } from '../domain/orders';
import { partnerTheme } from './palette';

// FEASTY brand status colors, aligned with the admin hub conventions.
// The shared packages/domain getOrderStatusColor stays untouched because the
// customer and dispatch apps still depend on its palette.
//
// FILL ONLY. Every value here is a saturated hue chosen to read at pill size,
// and the call sites all consume it as `${color}20` — a 12.5% tint. Used as the
// *label* colour on that tint (which is what two of the three screens did) six
// of the seven branches fail AA, because each colour is then sitting on a wash
// of itself:
//   placed         #f57c00 on #feefdf  2.40:1
//   accepted/prep  #2e7d32 on #e5efe5  4.35:1
//   in-transit     #117c6a on #e1efec  4.32:1
//   delivered      #2e7d32 on #e5efe5  4.35:1
//   cancelled etc. #c54a43 on #f8e8e7  3.99:1
//   escalated      #f57c00 on #feefdf  2.40:1
//   default        #54626f on #eaebed  5.25:1  (the only pass)
// Darkening six hues would not fix this — the tint darkens with them. So the
// rule is the one `Badge` already encodes and order/[id].tsx already applies:
// the tint carries the status hue, the label is a plain legible foreground.
// Nothing may render this return value as text.
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
