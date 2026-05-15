import { serviceClient } from './client.ts';
import { verifySupabaseJwt } from './auth.ts';

type UserProfile = {
  accountDisabled?: boolean | null;
  email?: string | null;
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

export const getAuthenticatedRequestContext = async (
  request: Request
): Promise<AuthenticatedRequestContext> => {
  const { claims, token } = await verifySupabaseJwt(request);
  const uid = extractClaimText(claims as Record<string, unknown>, 'sub');

  if (!uid) {
    throw new Error('Authenticated request is missing a valid user id.');
  }

  const { data: userProfile, error } = await serviceClient
    .from('user_profiles')
    .select('uid, email, role, accountDisabled')
    .eq('uid', uid)
    .maybeSingle<UserProfile>();

  if (error) {
    throw new Error(error.message);
  }

  if (!userProfile) {
    throw new Error('Authenticated profile could not be found.');
  }

  if (userProfile.accountDisabled) {
    throw new Error('This account is disabled.');
  }

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
