// An order is only offered to a rider who is (a) KYC-approved and (b) reporting
// a recent location. Matching previously checked neither, so a pending/unverified
// rider, or one whose app last pinged hours ago, could be offered and accept a
// real delivery. Pure function; the DB reads live in dispatchSelection.ts.
export const DISPATCH_MAX_LOCATION_AGE_SECONDS = 120;

export const isRiderEligibleForOffer = (args: {
  verificationStatus: string | null | undefined;
  lastLocationAtMs: number | null;
  nowMs: number;
  maxAgeSeconds: number;
}): boolean => {
  if (args.verificationStatus !== 'approved') return false;
  if (args.lastLocationAtMs === null) return false;
  return args.nowMs - args.lastLocationAtMs <= args.maxAgeSeconds * 1000;
};
