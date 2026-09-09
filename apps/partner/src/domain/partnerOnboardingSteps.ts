/**
 * Step model for partner onboarding.
 *
 * THE CONTRACT. This mirrors, on the client, exactly what
 * validatePartnerOnboardingSubmission (supabase/functions/_shared/partnerOnboarding.ts)
 * requires of `submitPartnerOnboarding`. The server stays the authority and
 * still throws on a bad payload; this exists so the wizard can refuse to
 * advance — and refuse to submit — instead of letting a partner fill five steps
 * and then hit a generic failure on the last one.
 *
 * Every required field below is required BY THE SERVER:
 *   restaurantName, contactName, email, phoneNumber, address, legalName,
 *   documentFrontPath, bankName, bankCode, accountNumber, and a
 *   deliveryRadiusKm that is finite and > 0. Latitude and longitude are
 *   optional but must be supplied together.
 *
 * `documentNumber` is required by the RPC's own type (it is hashed server-side
 * and never stored), and `bankVerifiedAccountName` is required by this wizard
 * rather than by the server: onboarding must not submit a bank account that has
 * not passed a live /bank/resolve, because approval later mints a Paystack
 * subaccount from it and a bad account cannot be settled to.
 *
 * Pure and IO-free so the gating rules are unit-testable without a device.
 */

export type PartnerOnboardingStepId = 'restaurant' | 'location' | 'payout' | 'verification' | 'review';

export const PARTNER_ONBOARDING_STEPS: readonly {
  id: PartnerOnboardingStepId;
  title: string;
  blurb: string;
}[] = [
  { blurb: 'How customers will see you', id: 'restaurant', title: 'Your restaurant' },
  { blurb: 'Where you cook and how far you deliver', id: 'location', title: 'Location & delivery' },
  { blurb: 'Where your money lands', id: 'payout', title: 'Payouts' },
  { blurb: 'Proof of identity, kept private', id: 'verification', title: 'Verification' },
  { blurb: 'Check everything before you send it', id: 'review', title: 'Review' },
];

/** Everything the wizard collects. Strings are raw form state, not yet trimmed. */
export type PartnerOnboardingFormState = {
  accountNumber: string;
  address: string;
  bankCode: string;
  bankName: string;
  /** Set only by a successful resolvePartnerBankAccount call. */
  bankVerifiedAccountName: string | null;
  contactName: string;
  cuisine: string;
  deliveryRadiusKm: string;
  deliveryTime: string;
  description: string;
  documentBackPath: string | null;
  documentFrontPath: string | null;
  documentNumber: string;
  documentType: string;
  email: string;
  latitude: string;
  legalName: string;
  logoImage: string | null;
  longitude: string;
  phoneNumber: string;
  restaurantName: string;
};

const filled = (value: string | null | undefined) => Boolean((value ?? '').trim());

/** Mirrors the server's `Number.isFinite(x) && x > 0` on deliveryRadiusKm. */
export const isValidDeliveryRadius = (value: string | null | undefined) => {
  const parsed = Number.parseFloat((value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0;
};

/**
 * Latitude and longitude are optional, but the server rejects one without the
 * other, and rejects non-numeric values when either is present.
 */
export const isValidCoordinatePair = (latitude: string, longitude: string) => {
  const hasLatitude = filled(latitude);
  const hasLongitude = filled(longitude);

  if (!hasLatitude && !hasLongitude) {
    return true;
  }
  if (hasLatitude !== hasLongitude) {
    return false;
  }
  return Number.isFinite(Number.parseFloat(latitude)) && Number.isFinite(Number.parseFloat(longitude));
};

/** Which of the collecting steps are complete. `review` is never "complete" — it is the submit gate. */
export const isStepComplete = (step: PartnerOnboardingStepId, form: PartnerOnboardingFormState): boolean => {
  switch (step) {
    case 'restaurant':
      return (
        filled(form.restaurantName) &&
        filled(form.legalName) &&
        filled(form.contactName) &&
        filled(form.phoneNumber) &&
        filled(form.email) &&
        form.email.includes('@') &&
        filled(form.cuisine)
      );
    case 'location':
      return (
        filled(form.address) &&
        isValidDeliveryRadius(form.deliveryRadiusKm) &&
        isValidCoordinatePair(form.latitude, form.longitude)
      );
    case 'payout':
      // The resolved name is the gate, not the typed digits: it is the only
      // evidence Paystack agrees this account exists.
      return filled(form.bankCode) && filled(form.bankName) && filled(form.accountNumber) && filled(form.bankVerifiedAccountName);
    case 'verification':
      return filled(form.documentType) && filled(form.documentNumber) && filled(form.documentFrontPath);
    case 'review':
      return false;
    default:
      return false;
  }
};

/** Every collecting step done, so `submitPartnerOnboarding` will not be rejected. */
export const canSubmitPartnerOnboarding = (form: PartnerOnboardingFormState) =>
  (['restaurant', 'location', 'payout', 'verification'] as const).every((step) => isStepComplete(step, form));

/**
 * The first step still missing something — where "Continue" should land a
 * partner resuming a saved draft, rather than dropping them on step 1 to
 * re-read fields they already filled.
 */
export const firstIncompleteStep = (form: PartnerOnboardingFormState): PartnerOnboardingStepId => {
  const collecting = ['restaurant', 'location', 'payout', 'verification'] as const;
  return collecting.find((step) => !isStepComplete(step, form)) ?? 'review';
};

/**
 * A changed bank code or account number invalidates a previously resolved name:
 * the resolve proved a *pair*, so re-verification is required before submit.
 */
export const shouldInvalidateBankVerification = ({
  nextAccountNumber,
  nextBankCode,
  verifiedAccountNumber,
  verifiedBankCode,
}: {
  nextAccountNumber: string;
  nextBankCode: string;
  verifiedAccountNumber: string | null;
  verifiedBankCode: string | null;
}) => nextAccountNumber.trim() !== (verifiedAccountNumber ?? '').trim() || nextBankCode.trim() !== (verifiedBankCode ?? '').trim();
