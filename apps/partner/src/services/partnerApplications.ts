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

/**
 * Uploads one KYC document and returns the storage PATH to submit with the
 * onboarding payload.
 *
 * The bucket is private (service-role only), so the client never gets a public
 * URL and never touches the bucket directly - it PUTs to a short-lived signed
 * URL minted by the server, then submits only the path. The file bytes are read
 * from the local picker URI, which on native is a file:// URI fetch() can read.
 */
export const uploadPartnerVerificationDocument = async ({
  contentType = 'image/jpeg',
  extension = 'jpg',
  fileUri,
  kind,
}: {
  contentType?: string;
  extension?: string;
  fileUri: string;
  kind: 'front' | 'back';
}): Promise<string> => {
  const target = await requestPartnerVerificationUploadUrl({ contentType, extension, kind });

  const file = await fetch(fileUri);
  if (!file.ok) {
    throw new Error('We could not read that image. Pick it again.');
  }
  const body = await file.arrayBuffer();

  const uploaded = await fetch(target.signedUrl, {
    body,
    headers: { 'Content-Type': target.contentType },
    method: 'PUT',
  });
  if (!uploaded.ok) {
    throw new Error('We could not upload that document. Check your connection and try again.');
  }

  return target.path;
};
