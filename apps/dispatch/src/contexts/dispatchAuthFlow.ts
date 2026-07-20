export const DISPATCH_ACCESS_ERROR = 'This account does not have dispatch access.';
export const MISSING_PROFILE_ERROR = 'No dispatch profile was found for this account.';
export const DISPATCH_APPLICATION_PENDING_MESSAGE = 'Your rider account is being prepared. Sign in again shortly.';
export const DISPATCH_APPLICATION_REJECTED_FALLBACK =
  'Your rider account is not active yet. Contact the operations team and update your details before trying again.';

export type DispatchClaimRole = 'customer' | 'dispatch' | null;

export type DispatchUserDocumentState = {
  dispatchApplicationRejectionReason?: string | null;
  dispatchApplicationStatus?: 'pending' | 'rejected' | 'approved' | null;
};

export type DispatchAccessState =
  | {
      kind: 'dispatch';
      userRole: 'dispatch';
    }
  | {
      kind: 'complete-profile';
      userRole: 'customer';
    }
  | {
      kind: 'blocked';
      message: string;
    };

type ResolveDispatchAccessStateInput = {
  claimRole: DispatchClaimRole;
  userDocument: DispatchUserDocumentState | null;
};

export const resolveDispatchAccessState = ({
  claimRole,
  userDocument,
}: ResolveDispatchAccessStateInput): DispatchAccessState => {
  if (!userDocument) {
    return {
      kind: 'blocked',
      message: MISSING_PROFILE_ERROR,
    };
  }

  if (userDocument.dispatchApplicationStatus === 'pending') {
    return {
      kind: 'blocked',
      message: DISPATCH_APPLICATION_PENDING_MESSAGE,
    };
  }

  if (userDocument.dispatchApplicationStatus === 'rejected') {
    return {
      kind: 'blocked',
      message: userDocument.dispatchApplicationRejectionReason ?? DISPATCH_APPLICATION_REJECTED_FALLBACK,
    };
  }

  if (claimRole === 'dispatch') {
    return {
      kind: 'dispatch',
      userRole: 'dispatch',
    };
  }

  return {
    kind: 'complete-profile',
    userRole: 'customer',
  };
};
