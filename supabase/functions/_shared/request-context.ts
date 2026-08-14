import { serviceClient } from './client.ts';
import { verifySupabaseJwt } from './auth.ts';
import { ClientSafeError } from './observability.ts';

type UserProfile = {
  accountDisabled?: boolean | null;
  deletionRequestedAt?: string | null;
  email?: string | null;
  purgeScheduledAt?: string | null;
  role?: string | null;
  uid: string;
};

export type AuthenticatedRequestContext = {
  email: string;
  role: string;
  token: string;
  uid: string;
  userProfile: UserProfile;
};

const extractClaimText = (claims: Record<string, unknown>, key: string) =>
  typeof claims[key] === 'string' && claims[key].trim() ? claims[key].trim() : null;

export type AccountAccessOptions = {
  /**
   * Only `cancelAccountDeletion` sets this. Everything else must be refused
   * while a deletion is pending, including all of the notifications function.
   */
  allowPendingDeletion?: boolean;
};

export const ACCOUNT_PENDING_DELETION_CODE = 'ACCOUNT_PENDING_DELETION';

/**
 * The access decision, kept pure so it can be tested without a database.
 * Disabled is checked first: a disabled account is refused even when the
 * pending-deletion exemption is in play.
 */
export const assertAccountAccessible = (
  profile: UserProfile,
  options: AccountAccessOptions = {}
): void => {
  if (profile.accountDisabled) {
    throw new ClientSafeError(403, 'This account is disabled.');
  }

  if (profile.deletionRequestedAt && options.allowPendingDeletion !== true) {
    throw new ClientSafeError(403, 'This account is scheduled for deletion.', {
      code: ACCOUNT_PENDING_DELETION_CODE,
      details: { purgeScheduledAt: profile.purgeScheduledAt ?? null },
    });
  }
};

export const getAuthenticatedRequestContext = async (
  request: Request,
  options: AccountAccessOptions = {}
): Promise<AuthenticatedRequestContext> => {
  const { claims, token } = await verifySupabaseJwt(request);
  const uid = extractClaimText(claims as Record<string, unknown>, 'sub');

  if (!uid) {
    throw new Error('Authenticated request is missing a valid user id.');
  }

  const { data: userProfile, error } = await serviceClient
    .from('user_profiles')
    .select('uid, email, role, accountDisabled, deletionRequestedAt, purgeScheduledAt')
    .eq('uid', uid)
    .maybeSingle<UserProfile>();

  if (error) {
    throw new Error(error.message);
  }

  if (!userProfile) {
    throw new Error('Authenticated profile could not be found.');
  }

  assertAccountAccessible(userProfile, options);

  const role =
    userProfile.role ??
    extractClaimText(claims as Record<string, unknown>, 'user_role') ??
    extractClaimText(claims as Record<string, unknown>, 'app_role') ??
    'customer';

  const email = userProfile.email?.trim();
  if (!email) {
    throw new Error('Authenticated profile is missing a valid email address.');
  }

  return {
    email,
    role,
    token,
    uid,
    userProfile,
  };
};
