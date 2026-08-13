import type { PartnerOnboardingReview as PartnerOnboardingReviewData } from '../../../../packages/domain/src';
import StatusBadge from './StatusBadge';
import type { AdminTone } from '../theme/tones';

const payoutTone = (status?: string | null): AdminTone => {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'failed') {
    return 'danger';
  }
  return 'warning';
};

const kycTone = (verifiedAt?: string | null): AdminTone => (verifiedAt ? 'success' : 'warning');

/**
 * Renders the KYC + payout review block for a partner application. Shows only
 * non-sensitive fields (last four, resolved name, verification state) plus links to
 * the short-lived signed document URLs. Legacy applications with no onboarding rows
 * render a small note instead.
 */
export default function PartnerOnboardingReview({
  review,
}: {
  review?: PartnerOnboardingReviewData | null;
}) {
  if (!review || (!review.kyc && !review.payout)) {
    return (
      <div className="list-row-sub onboarding-review-empty">
        No KYC or payout details captured (legacy application).
      </div>
    );
  }

  const { kyc, payout, documents } = review;

  return (
    <div className="onboarding-review">
      {kyc ? (
        <div className="onboarding-review-block">
          <span className="onboarding-review-label">KYC</span>
          <StatusBadge label={kyc.verifiedAt ? 'verified' : kyc.status} tone={kycTone(kyc.verifiedAt)} />
          {kyc.legalName ? <span className="list-row-sub">{kyc.legalName}</span> : null}
          {kyc.documentLast4 ? (
            <span className="list-row-sub">Doc •••• {kyc.documentLast4}</span>
          ) : null}
          <span className="onboarding-review-docs">
            {documents.frontUrl ? (
              <a href={documents.frontUrl} target="_blank" rel="noreferrer" className="onboarding-review-doc-link">
                View front
              </a>
            ) : (
              <span className="list-row-sub">No front doc</span>
            )}
            {documents.backUrl ? (
              <a href={documents.backUrl} target="_blank" rel="noreferrer" className="onboarding-review-doc-link">
                View back
              </a>
            ) : null}
          </span>
        </div>
      ) : null}

      {payout ? (
        <div className="onboarding-review-block">
          <span className="onboarding-review-label">Payout</span>
          <StatusBadge label={payout.status} tone={payoutTone(payout.status)} />
          <span className="list-row-sub">
            {payout.bankName ?? 'Bank pending'}
            {payout.accountLast4 ? ` •••• ${payout.accountLast4}` : ''}
          </span>
          {payout.resolvedAccountName ? (
            <span className="list-row-sub">{payout.resolvedAccountName}</span>
          ) : null}
          <span className="list-row-sub">
            {payout.paystackSubaccountCode ? 'Subaccount ready' : 'No subaccount yet'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
