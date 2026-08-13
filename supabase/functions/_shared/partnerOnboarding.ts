const PARTNER_VERIFICATION_BUCKET = 'partner-verification-documents';

export type PartnerOnboardingDocumentType = 'nin' | 'tax_id';

export type PartnerOnboardingStateKind =
  | 'draft'
  | 'pending-verification'
  | 'verification-failed'
  | 'approved';

export type PartnerOnboardingState = {
  kind: PartnerOnboardingStateKind;
  message?: string;
};

export type NormalizePartnerOnboardingStateInput = {
  partnerApplicationRejectionReason?: string | null;
  partnerApplicationStatus?: string | null;
  role?: string | null;
};

export type BuildPartnerVerificationDocPathInput = {
  extension: string;
  kind: string;
  restaurantId: string;
  uid: string;
};

export type BuildPartnerVerificationUploadRequestInput = {
  contentType: string;
  extension: string;
  kind: string;
  restaurantId: string;
  uid: string;
};

export type PartnerOnboardingSubmissionInput = {
  accountNumber?: string | null;
  address?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  contactName?: string | null;
  cuisine?: string | null;
  deliveryRadiusKm?: number | null;
  deliveryTime?: string | null;
  description?: string | null;
  documentBackPath?: string | null;
  documentFrontPath?: string | null;
  documentType?: string | null;
  email?: string | null;
  latitude?: number | null;
  legalName?: string | null;
  longitude?: number | null;
  phoneNumber?: string | null;
  restaurantName?: string | null;
};

export type ValidatedPartnerOnboardingSubmission = {
  accountNumber: string;
  address: string;
  bankCode: string;
  bankName: string;
  contactName: string;
  cuisine: string;
  deliveryRadiusKm: number;
  deliveryTime: string;
  description: string;
  documentBackPath: string;
  documentFrontPath: string;
  documentType: PartnerOnboardingDocumentType;
  email: string;
  latitude: number | null;
  legalName: string;
  longitude: number | null;
  phoneNumber: string;
  restaurantName: string;
};

const normalizeText = (value: string | null | undefined) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeLowerText = (value: string | null | undefined) => normalizeText(value).toLowerCase();

const normalizePathSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

const normalizeFileExtension = (value: string) => normalizePathSegment(value).replace(/^\.+/, '');

export const buildPartnerVerificationDocPath = ({
  extension,
  kind,
  restaurantId,
  uid,
}: BuildPartnerVerificationDocPathInput) => {
  const normalizedUid = normalizePathSegment(uid);
  const normalizedRestaurantId = normalizePathSegment(restaurantId);
  const normalizedKind = normalizePathSegment(kind);
  const normalizedExtension = normalizeFileExtension(extension) || 'jpg';

  if (!normalizedUid) {
    throw new Error('A partner uid is required for verification uploads.');
  }

  if (!normalizedRestaurantId) {
    throw new Error('A restaurant id is required for verification uploads.');
  }

  if (!normalizedKind) {
    throw new Error('A verification document kind is required.');
  }

  return `${PARTNER_VERIFICATION_BUCKET}/${normalizedUid}/${normalizedRestaurantId}/${normalizedKind}.${normalizedExtension}`;
};

export const buildPartnerVerificationUploadRequest = (input: BuildPartnerVerificationUploadRequestInput) => ({
  bucket: PARTNER_VERIFICATION_BUCKET,
  contentType: input.contentType,
  path: buildPartnerVerificationDocPath(input),
});

export const normalizePartnerOnboardingState = ({
  partnerApplicationRejectionReason,
  partnerApplicationStatus,
  role,
}: NormalizePartnerOnboardingStateInput): PartnerOnboardingState => {
  const status = normalizeLowerText(partnerApplicationStatus);
  const roleValue = normalizeLowerText(role);

  if (roleValue === 'restaurant' || status === 'approved' || status === 'verified' || status === 'subaccount_created') {
    return { kind: 'approved' };
  }

  if (status === 'pending_verification' || status === 'pending-verification' || status === 'pending') {
    return { kind: 'pending-verification' };
  }

  if (status === 'verification_failed' || status === 'verification-failed' || status === 'rejected') {
    return {
      kind: 'verification-failed',
      message: partnerApplicationRejectionReason?.trim() || 'Your partner application needs attention.',
    };
  }

  return { kind: 'draft' };
};

export const normalizePartnerOnboardingDocumentType = (value: string | null | undefined): PartnerOnboardingDocumentType => {
  const normalized = normalizeLowerText(value).replace(/[\s-]+/g, '_');

  if (normalized === 'tax_id' || normalized === 'taxid' || normalized === 'tin') {
    return 'tax_id';
  }

  return 'nin';
};

export const normalizeDocumentValue = (value: string | null | undefined) =>
  normalizeText(value)
    .replace(/[\s-]+/g, '')
    .toUpperCase();

export const derivePartnerDocumentLast4 = (value: string | null | undefined) => {
  const normalized = normalizeDocumentValue(value);

  if (!normalized) {
    return '';
  }

  return normalized.slice(-4);
};

export const derivePartnerDocumentHash = async (value: string | null | undefined) => {
  const normalized = normalizeDocumentValue(value);

  if (!normalized) {
    return '';
  }

  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const validatePartnerOnboardingSubmission = (
  input: PartnerOnboardingSubmissionInput
): ValidatedPartnerOnboardingSubmission => {
  const restaurantName = normalizeText(input.restaurantName);
  const contactName = normalizeText(input.contactName);
  const email = normalizeText(input.email).toLowerCase();
  const phoneNumber = normalizeText(input.phoneNumber);
  const address = normalizeText(input.address);
  const cuisine = normalizeText(input.cuisine);
  const description = normalizeText(input.description);
  const deliveryTime = normalizeText(input.deliveryTime) || '30-45 min';
  const legalName = normalizeText(input.legalName);
  const documentFrontPath = normalizeText(input.documentFrontPath);
  const documentBackPath = normalizeText(input.documentBackPath);
  const bankName = normalizeText(input.bankName);
  const bankCode = normalizeText(input.bankCode);
  const accountNumber = normalizeText(input.accountNumber);
  const documentType = normalizePartnerOnboardingDocumentType(input.documentType);
  const latitude =
    input.latitude === null || input.latitude === undefined ? null : Number.parseFloat(String(input.latitude));
  const longitude =
    input.longitude === null || input.longitude === undefined ? null : Number.parseFloat(String(input.longitude));
  const deliveryRadiusKm =
    input.deliveryRadiusKm === null || input.deliveryRadiusKm === undefined
      ? NaN
      : Number.parseFloat(String(input.deliveryRadiusKm));

  if (!restaurantName) {
    throw new Error('A restaurant name is required.');
  }
  if (!contactName) {
    throw new Error('A contact name is required.');
  }
  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required.');
  }
  if (!phoneNumber) {
    throw new Error('A phone number is required.');
  }
  if (!address) {
    throw new Error('A restaurant address is required.');
  }
  if (!legalName) {
    throw new Error('A legal name is required.');
  }
  if (!documentFrontPath) {
    throw new Error('A front-side verification document is required.');
  }
  if (!bankName) {
    throw new Error('A bank name is required.');
  }
  if (!bankCode) {
    throw new Error('A bank code is required.');
  }
  if (!accountNumber) {
    throw new Error('An account number is required.');
  }
  if (!Number.isFinite(deliveryRadiusKm) || deliveryRadiusKm <= 0) {
    throw new Error('A positive delivery radius is required.');
  }

  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;

  if (hasLatitude !== hasLongitude) {
    throw new Error('Provide both latitude and longitude together.');
  }

  if (hasLatitude && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new Error('Use valid numeric coordinates for the restaurant.');
  }

  return {
    accountNumber,
    address,
    bankCode,
    bankName,
    contactName,
    cuisine,
    deliveryRadiusKm,
    deliveryTime,
    description,
    documentBackPath,
    documentFrontPath,
    documentType,
    email,
    latitude,
    legalName,
    longitude,
    phoneNumber,
    restaurantName,
  };
};

// ---------------------------------------------------------------------------
// Payout activation helpers (Task 4)
//
// These are deliberately pure and split-agnostic so they can be unit-tested
// without touching Paystack, and so the eventual money-split decision (see the
// note in app-rpc/index.ts) lives entirely at the call site, not baked in here.
// ---------------------------------------------------------------------------

export const PARTNER_PAYOUT_STATUS = {
  PENDING: 'pending',
  RESOLVED: 'resolved',
  ACTIVE: 'active',
  FAILED: 'failed',
} as const;

export type PartnerPayoutStatus = (typeof PARTNER_PAYOUT_STATUS)[keyof typeof PARTNER_PAYOUT_STATUS];

export type PartnerPayoutSubaccountState = {
  paystackSubaccountCode?: string | null;
  status?: string | null;
};

/**
 * A restaurant's subaccount may only be attached to a live customer payment when
 * its payout profile is fully active AND a subaccount code has actually been
 * stored. Anything short of that must route the payment through the platform
 * account alone rather than silently mis-splitting or failing.
 */
export const shouldAttachPartnerSubaccount = (
  payout: PartnerPayoutSubaccountState | null | undefined
): boolean => {
  if (!payout) {
    return false;
  }

  const status = normalizeLowerText(payout.status);
  const code = normalizeText(payout.paystackSubaccountCode);

  return status === PARTNER_PAYOUT_STATUS.ACTIVE && code.length > 0;
};

export type PaystackSubaccountCreatePayload = {
  account_number: string;
  business_name: string;
  /** Bank code as Paystack expects it under `settlement_bank`. */
  settlement_bank: string;
  /**
   * Paystack requires this at creation. The actual per-order routing is done
   * with a transaction-level split (pricing v2 is flat + percentage, so the
   * restaurant's cut varies per order), which overrides this value — hence it
   * is passed in explicitly by the caller rather than assumed here.
   */
  percentage_charge: number;
};

export type BuildPaystackSubaccountPayloadInput = {
  accountNumber: string;
  bankCode: string;
  businessName: string;
  percentageCharge: number;
};

export const buildPaystackSubaccountPayload = ({
  accountNumber,
  bankCode,
  businessName,
  percentageCharge,
}: BuildPaystackSubaccountPayloadInput): PaystackSubaccountCreatePayload => {
  const account_number = normalizeText(accountNumber).replace(/\s+/g, '');
  const settlement_bank = normalizeText(bankCode);
  const business_name = normalizeText(businessName);

  if (!business_name) {
    throw new Error('A business name is required to create a payout subaccount.');
  }
  if (!settlement_bank) {
    throw new Error('A settlement bank code is required to create a payout subaccount.');
  }
  if (!account_number) {
    throw new Error('An account number is required to create a payout subaccount.');
  }
  if (!Number.isFinite(percentageCharge) || percentageCharge < 0 || percentageCharge > 100) {
    throw new Error('percentageCharge must be a number between 0 and 100.');
  }

  return { account_number, business_name, settlement_bank, percentage_charge: percentageCharge };
};

export type FinalizePartnerApprovalInput = {
  accountNumber: string;
  /** When present, the existing subaccount is reused and no creation happens. */
  existingSubaccountCode?: string | null;
  paystackBankCode: string;
  paystackBankName: string;
  resolvedAccountName: string;
  /**
   * Injected so the pure helper stays testable and Paystack-free. Only invoked
   * when there is no existing code to reuse. Must return the new subaccount code.
   */
  createSubaccount?: (payload: PaystackSubaccountCreatePayload) => Promise<string>;
  /** Passed straight through to `buildPaystackSubaccountPayload` on the create path. */
  percentageCharge?: number;
};

export type FinalizePartnerApprovalResult = {
  paystackSubaccountCode: string;
  /** True only when a new subaccount was created on this call. */
  created: boolean;
  status: PartnerPayoutStatus;
};

/**
 * Idempotent subaccount resolution for the approval boundary.
 *
 * If a subaccount code is already stored it is reused verbatim — a retried
 * approval must never create a second Paystack subaccount for the same
 * restaurant. Only when nothing is stored does it call the injected creator.
 */
export const finalizePartnerApproval = async (
  input: FinalizePartnerApprovalInput
): Promise<FinalizePartnerApprovalResult> => {
  const existing = normalizeText(input.existingSubaccountCode);
  if (existing) {
    return { paystackSubaccountCode: existing, created: false, status: PARTNER_PAYOUT_STATUS.ACTIVE };
  }

  if (typeof input.createSubaccount !== 'function') {
    throw new Error('A subaccount creator is required when no subaccount code exists yet.');
  }

  const payload = buildPaystackSubaccountPayload({
    accountNumber: input.accountNumber,
    bankCode: input.paystackBankCode,
    businessName: input.resolvedAccountName,
    percentageCharge: input.percentageCharge ?? 0,
  });

  const created = normalizeText(await input.createSubaccount(payload));
  if (!created) {
    throw new Error('Paystack did not return a subaccount code.');
  }

  return { paystackSubaccountCode: created, created: true, status: PARTNER_PAYOUT_STATUS.ACTIVE };
};
