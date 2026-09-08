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

export type PartnerPayoutStatus = 'pending' | 'resolved' | 'active' | 'failed' | string;

/** Non-sensitive payout state for partner/admin reads. Never carries the full
 *  account number — only the resolved name and last four. */
export interface RestaurantPayoutSummary {
  status?: PartnerPayoutStatus;
  bankName?: string | null;
  accountLast4?: string | null;
  resolvedAccountName?: string | null;
  paystackSubaccountCode?: string | null;
}

/** Non-sensitive KYC state for partner/admin reads. Never carries the raw
 *  document number — only its last four and verification state. */
export interface RestaurantKycSummary {
  status?: 'pending' | 'manual' | 'verified' | 'rejected' | string;
  legalName?: string | null;
  documentLast4?: string | null;
  verifiedAt?: string | null;
}

export interface UserDocument extends DocumentData {
  uid: string;
  email: string;
  role: AppRole;
  emailVerified: boolean;
  displayName?: string;
  phoneNumber?: string;
  partnerApplicationStatus?: 'pending' | 'pending_verification' | 'verification_failed' | 'approved' | 'rejected' | string;
  partnerApplicationReviewedAt?: string | null;
  partnerApplicationRejectionReason?: string | null;
  /** Populated for partner/admin onboarding reads; absent for other roles. */
  partnerPayout?: RestaurantPayoutSummary | null;
  partnerKyc?: RestaurantKycSummary | null;
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
  // Task 16 (F2): set only via partnerSetMenuItemAvailability. Unavailable
  // when isAvailable === false (manual, indefinite) OR this is a still-future
  // timestamp (timed, auto-resumes with no write once it passes — see
  // supabase/functions/_shared/availability.ts's isMenuItemAvailable).
  unavailableUntil?: string | null;
  modifierGroups?: ModifierGroupDocument[] | null;
}

export interface ModifierOptionDocument extends DocumentData {
  id: string;
  label?: string | null;
  priceDelta?: number | null;
  isAvailable?: boolean | null;
}

export interface ModifierGroupDocument extends DocumentData {
  id: string;
  label?: string | null;
  mode?: 'single' | 'multi' | string | null;
  required?: boolean | null;
  min?: number | null;
  max?: number | null;
  options?: ModifierOptionDocument[] | null;
}

export interface OrderItemSelectedOptionDocument extends DocumentData {
  groupId: string;
  groupLabel?: string | null;
  optionId: string;
  optionLabel?: string | null;
  priceDelta?: number | null;
}

export interface OrderGroupSummaryDocument extends DocumentData {
  id: string;
  orderIds?: string[] | null;
  orderCount?: number | null;
  primaryOrderId?: string | null;
  pricing?: OrderPriceBreakdown | null;
  payment?: OrderPaymentSummary | null;
  restaurantIds?: string[] | null;
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
  /** Paystack subaccount that receives this restaurant's settlement split. */
  paystackSubaccountCode?: string | null;
  menu?: MenuCategoryDocument[] | null;
  // Task 16 (F2): set only via partnerSetStorePause. Paused while this is a
  // still-future timestamp; auto-resumes with no write once it passes (see
  // supabase/functions/_shared/availability.ts's isStorePaused). Always
  // cleared (null) when not paused — there is no indefinite store pause.
  pausedUntil?: string | null;
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
  optionDelta?: number | null;
  selectedOptions?: OrderItemSelectedOptionDocument[] | null;
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
  /**
   * Task 8 (C2) settlement figures, written by the server on placement
   * (_shared/domains/orders.ts). `netSettlement` is what the restaurant's
   * subaccount receives. Absent on legacy orders.
   */
  settlement?: {
    netSettlement?: number;
    platformFee?: number;
  } | null;
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
  // Task 18 (G2): stamped at creation for a scheduled order (placedAt is stamped
  // later, at release, so the acceptance-deadline clock starts at release).
  scheduledAt?: unknown;
  scheduledFor?: unknown;
  scheduledReleasedAt?: unknown;
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
  // Task 18 (G2): the customer-requested slot (UTC instant), or null for an
  // immediate order.
  scheduledFor?: unknown | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryLocation?: AddressRecord | null;
  orderGroupId?: string | null;
  orderGroup?: OrderGroupSummaryDocument | null;
  groupOrders?: OrderDocument[] | null;
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
  licenseNumber?: string | null;
  verifiedAt?: string | null;
  verifiedByUid?: string | null;
  verificationStatus?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehiclePlateNumber?: string | null;
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

/** Admin review block for a partner application: KYC/payout summaries plus short-lived
 *  signed URLs for the private verification documents. Never carries raw NIN or the full
 *  account number. Absent for legacy applications submitted before the onboarding flow. */
export interface PartnerOnboardingReview {
  kyc: {
    status: string;
    legalName: string | null;
    documentLast4: string | null;
    verifiedAt: string | null;
  } | null;
  payout: {
    status: PartnerPayoutStatus;
    bankName: string | null;
    accountLast4: string | null;
    resolvedAccountName: string | null;
    paystackSubaccountCode: string | null;
  } | null;
  documents: {
    frontUrl: string | null;
    backUrl: string | null;
  };
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
  onboarding?: PartnerOnboardingReview | null;
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
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehiclePlateNumber?: string | null;
  licenseNumber?: string | null;
  licenceFrontPath?: string | null;
  licenceBackPath?: string | null;
  latitude: number;
  longitude: number;
  currentAddress?: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  verificationStatus?: 'pending' | 'approved' | 'rejected' | string;
  submittedAt: string;
  reviewedAt?: string | null;
  approvedByUid?: string | null;
  verifiedByUid?: string | null;
  verifiedAt?: string | null;
  reviewNotes?: string | null;
  rejectionReason?: string | null;
}

export interface DispatchShiftSlotDocument extends DocumentData {
  id: string;
  courierId: string;
  startsAt: string;
  endsAt: string;
  forecastDemand: number;
  status: string;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CourierEarningDocument extends DocumentData {
  id: string;
  courierId: string;
  orderId: string;
  amount: number;
  currency: string;
  deliveredAt: string;
  restaurantId?: string | null;
  restaurantName?: string | null;
  payoutId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CourierPayoutDocument extends DocumentData {
  id: string;
  courierId: string;
  periodStartsAt: string;
  periodEndsAt: string;
  currency: string;
  ledgerTotal: number;
  status: string;
  paidAt?: string | null;
  reference?: string | null;
  reviewNotes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}
