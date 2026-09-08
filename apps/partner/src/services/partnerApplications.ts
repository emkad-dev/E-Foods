import { callPartnerBackendRpc } from './backendRpc';
import type { PolicyAcceptancePayload } from '../../../../packages/domain/src';

export type PartnerApplicationInput = {
  accountNumber?: string | null;
  address: string;
  bankCode?: string | null;
  bankName?: string | null;
  contactName: string;
  cuisine: string;
  deliveryRadiusKm?: number | null;
  deliveryTime?: string;
  description?: string;
  documentBackPath?: string | null;
  documentFrontPath?: string | null;
  documentType?: string | null;
  latitude?: number | null;
  legalName?: string | null;
  logoImage?: string | null;
  longitude?: number | null;
  phoneNumber: string;
  policyAcceptance?: PolicyAcceptancePayload;
  restaurantName: string;
};

export const submitPartnerApplication = async (input: PartnerApplicationInput) =>
  callPartnerBackendRpc<{
    status: 'pending';
    submittedAt: string;
    restaurantId: string;
    targetUid: string;
  }>('submitPartnerApplication', input);

/** Full single-flow onboarding payload: restaurant identity + KYC + payout. The raw
 *  document number is sent once for server-side hashing and is never persisted. */
export type PartnerOnboardingInput = PartnerApplicationInput & {
  accountNumber: string;
  bankCode: string;
  bankName: string;
  /** Raw verification document number (e.g. NIN); hashed server-side, not stored. */
  documentNumber: string;
  documentFrontPath: string;
  documentType?: string | null;
  email?: string | null;
  legalName: string;
};

export const submitPartnerOnboarding = async (input: PartnerOnboardingInput) =>
  callPartnerBackendRpc<{
    status: 'pending';
    submittedAt: string;
    restaurantId: string;
    payoutStatus: string;
    resolvedAccountName: string;
    targetUid: string;
  }>('submitPartnerOnboarding', input);

export type PartnerVerificationUploadTarget = {
  bucket: string;
  contentType: string;
  path: string;
  signedUrl: string;
  token: string;
};

/** Requests a signed URL for a private KYC document upload. The client PUTs the file
 *  to `signedUrl`, then submits `path` back with the onboarding payload. */
export const requestPartnerVerificationUploadUrl = async (input: {
  kind: string;
  extension?: string;
  contentType?: string;
}) => callPartnerBackendRpc<PartnerVerificationUploadTarget>('requestPartnerVerificationUploadUrl', input);

/** Resolves the account holder name for a bank account so the wizard can confirm it
 *  before submitting. */
export const resolvePartnerBankAccount = async (input: { bankCode: string; accountNumber: string }) =>
  callPartnerBackendRpc<{ accountName: string; accountNumber: string }>('resolvePartnerBankAccount', input);
