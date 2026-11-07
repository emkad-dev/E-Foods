import { serviceClient } from './client.ts';

// Columns the dispatch and partner apps read from the user_profiles view at
// sign-in (packages/auth/src/profileApi.ts USER_PROFILE_COLUMNS). Selected
// verbatim so the bootstrap profile maps through the same client mapper with no
// reshaping, and so the call exposes exactly what the direct read it replaces
// already did: the caller's own row, nothing more.
const BOOTSTRAP_PROFILE_COLUMNS =
  'uid,email,displayName,phoneNumber,photoURL,emailVerified,role,partnerApplicationStatus,partnerApplicationReviewedAt,partnerApplicationRejectionReason,dispatchApplicationStatus,dispatchApplicationReviewedAt,dispatchApplicationRejectionReason,expoPushToken,pushTokenUpdatedAt,activeSessionId,activeSessionUpdatedAt,accountDisabled,disabledAt,disabledByUid,lastPrivilegedRole,restaurantId,restaurantName,restaurantLinkedAt,restaurantLinkSource,createdAt,updatedAt';

/**
 * The signed-in caller's own user_profiles row, or null when none exists yet
 * (the client then creates it through its existing fallback chain). Always keyed
 * by the authenticated uid, never by request data.
 */
export const loadOwnBootstrapProfile = async (uid: string): Promise<Record<string, unknown> | null> => {
  const { data, error } = await serviceClient
    .from('user_profiles')
    .select(BOOTSTRAP_PROFILE_COLUMNS)
    .eq('uid', uid)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};
