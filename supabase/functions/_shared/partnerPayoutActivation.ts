// Decides what approving a partner application must do about its payout
// profile, given only the current RestaurantPayout row. Extracted from the
// admin handler so the idempotency rule is unit testable without Paystack or
// a database, same as partnerApplicationTransitions.ts.
//
// The rule: an existing subaccount code is ALWAYS reused. A retried review
// must never create a second Paystack subaccount for one restaurant, and
// status is not part of that decision — a row can be 'failed' with a code
// already minted if a later step threw, and re-creating then would duplicate
// the payout account.

export type PayoutActivationPlan =
  | { action: 'reuse'; subaccountCode: string }
  | { action: 'create' }
  | { action: 'blocked'; httpStatus: 412; message: string };

const MISSING_PAYOUT_MESSAGE =
  'This partner has no payout details on file. They must resubmit onboarding with a bank account before approval.';

export const resolvePayoutActivationPlan = (
  payout: { paystackSubaccountCode?: string | null; status?: string | null } | null | undefined
): PayoutActivationPlan => {
  if (!payout) {
    return { action: 'blocked', httpStatus: 412, message: MISSING_PAYOUT_MESSAGE };
  }

  const existingCode = (payout.paystackSubaccountCode ?? '').trim();
  if (existingCode) {
    return { action: 'reuse', subaccountCode: existingCode };
  }

  return { action: 'create' };
};
