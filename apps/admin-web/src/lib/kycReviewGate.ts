/**
 * The gate that stops a partner being approved sight-unseen.
 *
 * WHY THIS EXISTS: Approve on the partner queue is the least reversible
 * control in the console. It flips the applicant's account to `restaurant`
 * and puts the payout details they typed in on the live money path. The only
 * evidence that the applicant is who they claim to be is the KYC document
 * pair, and the queue rendered signed links to those documents while leaving
 * Approve enabled whether or not anyone had ever clicked one. Nothing in the
 * screen, the RPC or the database asked.
 *
 * WHAT THIS CAN AND CANNOT CLAIM: a browser can observe that a link was
 * ACTIVATED. It cannot observe that a human read the document behind it, and
 * this module must never imply otherwise -- so every string it produces says
 * "opened", never "checked" or "verified". The caller holds the opened set in
 * component state for the length of the session on purpose: persisting it
 * would dress a client-side nudge up as a compliance record it cannot support,
 * and that is a worse defect than the one being fixed.
 *
 * "BOTH DOCUMENTS" IS REALLY "EVERY DOCUMENT THE SERVER SENT". An application
 * whose onboarding predates document capture has no links to open, and
 * demanding two clicks that cannot exist would leave that partner permanently
 * un-approvable with no remedy anywhere in the console -- the same shape of
 * seam as the missing payout row that once made every partner un-approvable.
 * So a review with no documents is reported as having none, in words, rather
 * than either blocking forever or silently counting as a pass.
 */

export type KycDocumentKey = 'back' | 'front';

export type KycDocuments = { backUrl: string | null; frontUrl: string | null } | null | undefined;

const DOCUMENT_LABELS: Record<KycDocumentKey, string> = { back: 'back', front: 'front' };

/** The documents this application actually has links for, in reading order. */
export const requiredKycDocuments = (documents: KycDocuments): KycDocumentKey[] => {
  const keys: KycDocumentKey[] = [];
  if (documents?.frontUrl) {
    keys.push('front');
  }
  if (documents?.backUrl) {
    keys.push('back');
  }
  return keys;
};

export type KycGate = {
  /**
   * Undefined means Approve may run. A string is both the disabling condition
   * AND the sentence shown next to the button: a disabled control with no
   * stated reason is its own defect, so the two are produced together and
   * cannot drift apart.
   */
  blockedReason: string | undefined;
  /** Standing context for the reviewer, shown whether or not Approve is blocked. */
  note: string;
};

export const resolveKycGate = (documents: KycDocuments, opened: Iterable<KycDocumentKey>): KycGate => {
  const required = requiredKycDocuments(documents);
  const seen = new Set(opened);
  const missing = required.filter((key) => !seen.has(key));

  if (required.length === 0) {
    return {
      blockedReason: undefined,
      note: 'No KYC documents were captured for this application, so there is nothing to open before approving.',
    };
  }

  if (missing.length > 0) {
    const list = missing.map((key) => DOCUMENT_LABELS[key]).join(' and ');
    return {
      blockedReason: `Open the KYC ${missing.length === 1 ? 'document' : 'documents'} (${list}) before approving.`,
      note: 'Opening a document is all this console can record about it.',
    };
  }

  return {
    blockedReason: undefined,
    note: `KYC ${required.length === 1 ? 'document' : 'documents'} opened in this session — opening is all this console can record.`,
  };
};
