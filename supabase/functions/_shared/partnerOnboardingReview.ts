// Admin-side review block for a pending partner application: KYC + payout
// summaries and short-lived signed URLs for the private verification documents.
// Never carries the raw NIN or the full account number.
//
// This lived in the monolithic app-rpc (dd302bb) and was lost when app-rpc was
// split into domain functions, so the admin queue silently stopped sending it.
import { serviceClient } from './client.ts';
import { PARTNER_VERIFICATION_BUCKET } from './partnerOnboarding.ts';
import { sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';

export type PartnerOnboardingReviewResponse = {
  kyc: {
    status: string;
    legalName: string | null;
    documentLast4: string | null;
    verifiedAt: string | null;
  } | null;
  payout: {
    status: string;
    bankName: string | null;
    accountLast4: string | null;
    resolvedAccountName: string | null;
    paystackSubaccountCode: string | null;
  } | null;
  documents: {
    frontUrl: string | null;
    backUrl: string | null;
  };
};

// Long enough to open the documents while reviewing, short enough that a
// leaked queue payload stops exposing ID photos within minutes.
const PARTNER_DOC_SIGNED_URL_TTL_SECONDS = 300;

// Stored paths carry the bucket prefix; storage.from(bucket) wants the object
// path relative to the bucket.
const toVerificationObjectPath = (path: unknown) => {
  const trimmed = sanitizeText(path);
  return trimmed.startsWith(`${PARTNER_VERIFICATION_BUCKET}/`)
    ? trimmed.slice(PARTNER_VERIFICATION_BUCKET.length + 1)
    : trimmed;
};

// A document that can't be signed degrades to a missing link rather than
// failing the whole queue.
const signVerificationDoc = async (path: unknown): Promise<string | null> => {
  const objectPath = toVerificationObjectPath(path);
  if (!objectPath) {
    return null;
  }
  const { data: signed, error } = await serviceClient.storage
    .from(PARTNER_VERIFICATION_BUCKET)
    .createSignedUrl(objectPath, PARTNER_DOC_SIGNED_URL_TTL_SECONDS);
  if (error || !signed) {
    return null;
  }
  return signed.signedUrl;
};

/**
 * KYC + payout state for a set of applicant uids. Applications with no
 * onboarding rows (legacy submissions) simply have no entry.
 */
export const loadPartnerOnboardingReviews = async (
  uids: string[]
): Promise<Map<string, PartnerOnboardingReviewResponse>> => {
  const reviews = new Map<string, PartnerOnboardingReviewResponse>();
  if (uids.length === 0) {
    return reviews;
  }

  const [{ data: kycRows, error: kycError }, { data: payoutRows, error: payoutError }] = await Promise.all([
    serviceClient
      .from('RestaurantKyc')
      .select('uid,legalName,ninLast4,ninFrontPath,ninBackPath,verification,verifiedAt')
      .in('uid', uids),
    serviceClient
      .from('RestaurantPayout')
      .select('uid,bankName,accountLast4,resolvedAccountName,paystackSubaccountCode,status')
      .in('uid', uids),
  ]);
  if (kycError) {
    throw new Error(kycError.message);
  }
  if (payoutError) {
    throw new Error(payoutError.message);
  }

  const kycByUid = new Map(
    ((kycRows ?? []) as Record<string, unknown>[]).map((row) => [sanitizeText(row.uid), row])
  );
  const payoutByUid = new Map(
    ((payoutRows ?? []) as Record<string, unknown>[]).map((row) => [sanitizeText(row.uid), row])
  );

  await Promise.all(
    uids.map(async (uid) => {
      const kyc = kycByUid.get(uid) ?? null;
      const payout = payoutByUid.get(uid) ?? null;
      if (!kyc && !payout) {
        return;
      }

      const [frontUrl, backUrl] = kyc
        ? await Promise.all([signVerificationDoc(kyc.ninFrontPath), signVerificationDoc(kyc.ninBackPath)])
        : [null, null];

      reviews.set(uid, {
        kyc: kyc
          ? {
              status: sanitizeText(kyc.verification, 'manual'),
              legalName: sanitizeOptionalText(kyc.legalName) ?? null,
              documentLast4: sanitizeOptionalText(kyc.ninLast4) ?? null,
              verifiedAt: (kyc.verifiedAt as string | null) ?? null,
            }
          : null,
        payout: payout
          ? {
              status: sanitizeText(payout.status, 'pending'),
              bankName: sanitizeOptionalText(payout.bankName) ?? null,
              accountLast4: sanitizeOptionalText(payout.accountLast4) ?? null,
              resolvedAccountName: sanitizeOptionalText(payout.resolvedAccountName) ?? null,
              paystackSubaccountCode: sanitizeOptionalText(payout.paystackSubaccountCode) ?? null,
            }
          : null,
        documents: { frontUrl, backUrl },
      });
    })
  );

  return reviews;
};
