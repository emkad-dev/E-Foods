import type { UserDocument } from '../domain/entities';

export const MISSING_PROFILE_ERROR = 'No partner profile was found for this account.';
export const PARTNER_APPLICATION_PENDING_MESSAGE = 'Your restaurant account is being prepared. Sign in again shortly.';
export const PARTNER_APPLICATION_REJECTED_FALLBACK =
  'Your restaurant account is not active yet. Update your details with the operations team before trying again.';
export const PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MS = 12000;
export const PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MESSAGE =
  'We saved your restaurant details, but your partner access is still syncing. Please stay on this screen and try again in a moment.';

export type PartnerClaimRole = 'customer' | 'restaurant' | null;
export type PartnerAccessUserRole = 'customer' | 'restaurant';

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

type ResolvePartnerRestaurantCompletionStateInput = {
  startedAt: number;
  userRole: PartnerAccessUserRole | null;
  now?: number;
  timeoutMs?: number;
};

export type PartnerRestaurantCompletionState =
  | {
      kind: 'ready';
    }
  | {
      kind: 'waiting';
    }
  | {
      kind: 'timed-out';
      message: string;
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

export const resolvePartnerRestaurantCompletionState = ({
  startedAt,
  userRole,
  now = Date.now(),
  timeoutMs = PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MS,
}: ResolvePartnerRestaurantCompletionStateInput): PartnerRestaurantCompletionState => {
  if (userRole === 'restaurant') {
    return {
      kind: 'ready',
    };
  }

  const elapsedMs = Math.max(0, now - startedAt);

  if (elapsedMs >= timeoutMs) {
    return {
      kind: 'timed-out',
      message: PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MESSAGE,
    };
  }

  return {
    kind: 'waiting',
  };
};

export type PartnerLandingRoute = 'dashboard' | 'under-review' | 'apply';

/**
 * Decides where a signed-in partner user belongs.
 *
 * Role is checked first and wins: the `restaurant` claim is granted only by an
 * admin approval, so once it is present the partner must reach the dashboard
 * even if the cached application status still reads `pending`.
 */
export const resolvePartnerLandingRoute = ({
  role,
  applicationStatus,
}: {
  role: string | null | undefined;
  applicationStatus: string | null | undefined;
}): PartnerLandingRoute => {
  const status = (applicationStatus ?? '').trim().toLowerCase();

  if (role === 'restaurant' || status === 'approved') {
    return 'dashboard';
  }

  if (status === 'pending' || status === 'pending_verification' || status === 'pending-verification') {
    return 'under-review';
  }

  if (status === 'rejected' || status === 'verification_failed' || status === 'verification-failed') {
    return 'apply';
  }

  return 'apply';
};
