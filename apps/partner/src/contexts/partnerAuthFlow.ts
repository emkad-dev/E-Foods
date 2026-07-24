import type { UserDocument } from '../domain/entities';

export const MISSING_PROFILE_ERROR = 'No partner profile was found for this account.';
export const PARTNER_APPLICATION_PENDING_MESSAGE = 'Your restaurant account is being prepared. Sign in again shortly.';
export const PARTNER_APPLICATION_REJECTED_FALLBACK =
  'Your restaurant account is not active yet. Update your details with the operations team before trying again.';

export type PartnerClaimRole = 'customer' | 'restaurant' | null;

export type PartnerUserDocumentState = Pick<
  UserDocument,
  'partnerApplicationRejectionReason' | 'partnerApplicationStatus' | 'role'
>;

export type PartnerAccessState =
  | {
      kind: 'restaurant';
      userRole: 'restaurant';
    }
  | {
      kind: 'complete-profile';
      userRole: 'customer';
    }
  | {
      kind: 'blocked';
      message: string;
    };

type ResolvePartnerAccessStateInput = {
  claimRole: PartnerClaimRole;
  userDocument: PartnerUserDocumentState | null;
};

export const resolvePartnerAccessState = ({
  claimRole,
  userDocument,
}: ResolvePartnerAccessStateInput): PartnerAccessState => {
  if (!userDocument) {
    return {
      kind: 'blocked',
      message: MISSING_PROFILE_ERROR,
    };
  }

  if (userDocument.partnerApplicationStatus === 'pending') {
    return {
      kind: 'blocked',
      message: PARTNER_APPLICATION_PENDING_MESSAGE,
    };
  }

  if (userDocument.partnerApplicationStatus === 'rejected') {
    return {
      kind: 'blocked',
      message: userDocument.partnerApplicationRejectionReason ?? PARTNER_APPLICATION_REJECTED_FALLBACK,
    };
  }

  if (claimRole === 'restaurant' || userDocument.role === 'restaurant' || userDocument.partnerApplicationStatus === 'approved') {
    return {
      kind: 'restaurant',
      userRole: 'restaurant',
    };
  }

  return {
    kind: 'complete-profile',
    userRole: 'customer',
  };
};
