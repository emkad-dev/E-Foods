// Decides what a partner application submit does, given the application's
// current status. Extracted from the app-rpc handler so the rule is unit
// testable without a database.
//
// The rule: submitting always lands in `pending` — approval is an admin
// decision, never a side effect of submitting. The single exception is an
// already-approved application, which must not be reopened by a resubmit.

export type PartnerApplicationStatus = 'pending' | 'approved' | 'rejected';

export type SubmitOutcome =
  | { allowed: true; nextStatus: 'pending' }
  | { allowed: false; httpStatus: 412; message: string };

const ALREADY_APPROVED_MESSAGE =
  'This partner application has already been approved. Sign in from the partner login screen.';

export const resolvePartnerSubmitOutcome = (
  currentStatus: string | null | undefined
): SubmitOutcome => {
  const normalized = (currentStatus ?? '').trim().toLowerCase();

  if (normalized === 'approved') {
    return { allowed: false, httpStatus: 412, message: ALREADY_APPROVED_MESSAGE };
  }

  // Everything else -- no application yet, pending, rejected, or an
  // unrecognised value -- results in a pending application. Defaulting an
  // unknown status to `pending` fails closed: the worst case is that an admin
  // reviews it again, never that an unvetted restaurant goes live.
  return { allowed: true, nextStatus: 'pending' };
};
