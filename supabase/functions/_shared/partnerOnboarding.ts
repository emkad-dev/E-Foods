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
