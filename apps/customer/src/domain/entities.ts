import type { AppRole } from './roles';
import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from './orders';

type DocumentData = Record<string, unknown>;

export type CurrencyCode = 'NGN' | 'USD' | string;

export interface AddressRecord extends DocumentData {
  id?: string;
  address: string;
  shortAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  label?: string | null;
  note?: string | null;
  isDefault?: boolean;
}

export interface UserDocument extends DocumentData {
  uid: string;
  email: string;
  role: AppRole;
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
  expoPushToken?: string;
  pushTokenUpdatedAt?: string;
  activeSessionId?: string | null;
  activeSessionUpdatedAt?: string | null;
  accountDisabled?: boolean;
  disabledAt?: string | null;
  disabledByUid?: string | null;
  lastPrivilegedRole?: AppRole | null;
  createdAt: string;
  updatedAt?: string;
}

export interface RestaurantDocument extends DocumentData {
  id: string;
  name: string;
  description?: string;
  image?: string;
  logoImage?: string | null;
  cuisine?: string;
  rating?: number;
  deliveryTime?: string | number;
  openingTime?: string | null;
  closingTime?: string | null;
  minOrder?: number;
  deliveryFee?: number;
  deliveryRadiusKm?: number | null;
  address?: string;
  approvalStatus?: string | null;
  supportsPickup?: boolean;
  supportsDelivery?: boolean;
  isOpen?: boolean;
  isPublished?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  menu?: MenuCategoryDocument[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MenuItemDocument extends DocumentData {
  id: string;
  name: string;
  description: string;
  price: number;
  image?: string;
  categoryId?: string;
  categoryLabel?: string;
  category?: string;
  isAvailable?: boolean;
}

export interface MenuCategoryDocument extends DocumentData {
  category: string;
  items: MenuItemDocument[];
}

export interface OrderItemDocument extends DocumentData {
  id: string;
  name: string;
  price: number;
  quantity: number;
  restaurantId: string;
  restaurantName: string;
  specialInstructions?: string;
}

export interface OrderPriceBreakdown extends DocumentData {
  currency: CurrencyCode;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tip: number;
  discount: number;
  total: number;
}

export interface OrderPaymentSummary extends DocumentData {
  method: PaymentMethod;
  status: PaymentStatus;
  reference?: string | null;
  processor?: string | null;
  accessCode?: string | null;
  authorizationUrl?: string | null;
  channel?: string | null;
  verifiedAt?: unknown | null;
  capturedAmount?: number;
  refundAmount?: number;
  lastEvent?: string | null;
  paidAt?: unknown | null;
  refundedAt?: unknown | null;
}

export interface OrderAssignmentSummary extends DocumentData {
  dispatchId?: string | null;
  dispatchOwnerId?: string | null;
  courierId?: string | null;
  courierName?: string | null;
  courierLatitude?: number | null;
  courierLongitude?: number | null;
  courierPhone?: string | null;
  courierUpdatedAt?: string | null;
}

export interface OrderTimeline extends DocumentData {
  placedAt?: unknown;
  acceptedAt?: unknown;
  preparingAt?: unknown;
  readyAt?: unknown;
  pickedUpAt?: unknown;
  deliveredAt?: unknown;
  cancelledAt?: unknown;
}

export interface OrderDocument extends DocumentData {
  id?: string;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
  items: OrderItemDocument[];
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  createdAt: unknown;
  updatedAt?: unknown;
  scheduledAt?: unknown | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryLocation?: AddressRecord | null;
  pricing: OrderPriceBreakdown;
  payment: OrderPaymentSummary;
  assignment?: OrderAssignmentSummary | null;
  cancellation?: {
    actor?: string | null;
    refundRate?: number | null;
  } | null;
  timeline?: OrderTimeline;
}
