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
  phoneNumber?: string;
  partnerApplicationStatus?: 'pending' | 'approved' | 'rejected' | string;
  partnerApplicationReviewedAt?: string | null;
  partnerApplicationRejectionReason?: string | null;
  dispatchApplicationStatus?: 'pending' | 'approved' | 'rejected' | string;
  dispatchApplicationReviewedAt?: string | null;
  dispatchApplicationRejectionReason?: string | null;
  photoURL?: string;
  restaurantId?: string;
  restaurantName?: string;
  restaurantLinkedAt?: string;
  restaurantLinkSource?: string;
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

export interface MenuItemDocument extends DocumentData {
  id: string;
  name: string;
  description?: string;
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

export interface RestaurantDocument extends DocumentData {
  id: string;
  ownerId?: string | null;
  name: string;
  description?: string;
  image?: string;
  logoImage?: string | null;
  cuisine?: string | null;
  rating?: number;
  deliveryTime?: string | number | null;
  openingTime?: string | null;
  closingTime?: string | null;
  minOrder?: number | null;
  deliveryFee?: number | null;
  address?: string | null;
  supportsPickup?: boolean | null;
  supportsDelivery?: boolean | null;
  isOpen?: boolean | null;
  isPublished?: boolean | null;
  deliveryRadiusKm?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  approvalStatus?: 'pending' | 'approved' | 'unpublished' | string;
  approvedAt?: string | null;
  approvedByUid?: string | null;
  menu?: MenuCategoryDocument[] | null;
  createdAt?: string;
  updatedAt?: string;
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
  /** Restaurant's own-price basis (Σ base price × qty). Absent on legacy orders. */
  restaurantBasis?: number;
  /** Platform service charge deducted from the basis (currently 0). Absent on legacy orders. */
  partnerServiceFee?: number;
  /** Food payout: basis − service charge. Legacy orders carry the commission-era value. */
  restaurantPayable?: number;
}

export interface OrderPaymentSummary extends DocumentData {
  method: PaymentMethod;
  status: PaymentStatus | string;
  reference?: string | null;
  processor?: string | null;
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
  onTheWayAt?: unknown;
  deliveredAt?: unknown;
  cancelledAt?: unknown;
  failedDeliveryAt?: unknown;
  escalatedAt?: unknown;
}

export interface OrderDocument extends DocumentData {
  id: string;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
  items: OrderItemDocument[];
  status: OrderStatus | string;
  fulfillmentType: FulfillmentType | string;
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

export interface DispatchProfileDocument extends DocumentData {
  id: string;
  displayName?: string | null;
  name?: string | null;
  fullName?: string | null;
  phoneNumber?: string | null;
  status?: string | null;
  zone?: string | null;
  currentZone?: string | null;
  region?: string | null;
  lga?: string | null;
  currentAddress?: string | null;
  vehicleType?: string | null;
  activeLoad?: number | string | null;
  completedTrips?: number | string | null;
  acceptanceRate?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  updatedAt?: unknown;
}

export interface RestaurantApprovalRecord {
  restaurantId: string;
  status: 'pending' | 'approved' | 'unpublished';
  approvedAt?: string | null;
  approvedByUid?: string | null;
}

export interface PartnerApplicationDocument extends DocumentData {
  id: string;
  uid: string;
  email: string;
  contactName: string;
  phoneNumber: string;
  restaurantName: string;
  cuisine: string;
  address: string;
  description?: string | null;
  logoImage?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deliveryTime?: string | null;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  reviewedAt?: string | null;
  approvedByUid?: string | null;
  rejectionReason?: string | null;
}

export interface DispatchApplicationDocument extends DocumentData {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  phoneNumber: string;
  region: string;
  lga: string;
  vehicleType: string;
  latitude: number;
  longitude: number;
  currentAddress?: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  submittedAt: string;
  reviewedAt?: string | null;
  approvedByUid?: string | null;
  rejectionReason?: string | null;
}
