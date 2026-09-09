/**
 * Nigerian bank codes for the payout step of partner onboarding.
 *
 * WHY A LOCAL LIST. Paystack's /bank endpoint is the authoritative catalogue,
 * but fetching it would need a new RPC action (the client has no Paystack
 * credentials, and must not). This list exists only to populate a picker so the
 * partner does not type a code by hand.
 *
 * WHY DRIFT IS SAFE. The code chosen here is never trusted. The wizard cannot
 * advance past the payout step until `resolvePartnerBankAccount` — which calls
 * Paystack's /bank/resolve server-side — returns the real account-holder name
 * for the (code, account number) pair. A stale or wrong code therefore fails
 * loudly at that gate with "we could not verify that bank account", and the
 * partner picks again. It can never reach approval, where a bad code would
 * mint a subaccount that cannot be settled to.
 *
 * Sorted for display. Add entries as needed; do not "fix" a code without
 * checking it against a live resolve first.
 */

export type NigeriaBank = {
  /** Paystack/CBN bank code, as sent to /bank/resolve. */
  code: string;
  name: string;
};

export const NIGERIA_BANKS: readonly NigeriaBank[] = [
  { code: '044', name: 'Access Bank' },
  { code: '023', name: 'Citibank Nigeria' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '214', name: 'First City Monument Bank' },
  { code: '00103', name: 'Globus Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '50211', name: 'Kuda Microfinance Bank' },
  { code: '303', name: 'Lotus Bank' },
  { code: '50515', name: 'Moniepoint Microfinance Bank' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
  { code: '104', name: 'Parallex Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '105', name: 'PremiumTrust Bank' },
  { code: '101', name: 'Providus Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '100', name: 'SunTrust Bank' },
  { code: '102', name: 'Titan Trust Bank' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
];

/**
 * NUBAN account numbers are exactly 10 digits. Checked before spending a
 * /bank/resolve round trip on input that cannot possibly resolve.
 */
export const isPlausibleNubanAccountNumber = (value: string | null | undefined) =>
  /^\d{10}$/.test((value ?? '').trim());
