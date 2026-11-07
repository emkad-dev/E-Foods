// Interactive dispatch / partner sign-in reads the caller's own profile through
// one authenticated call (dispatchBootstrap / partnerBootstrap) instead of a
// direct PostgREST read, so the request lands on the function the warmer keeps
// warm. It returns exactly the row that read returned; customer has its own
// richer customerBootstrap.
import type { UserDocument } from '../../domain/src/entities';
import { isBackendRpcError } from './backendRpc.ts';
import { mapUserProfileRecord } from './profileApi.ts';
import { retryOnceOnTransientFailure } from './transientNetworkFailure.ts';

export type ProfileBootstrapAction = 'dispatchBootstrap' | 'partnerBootstrap';

export type ProfileBootstrap = {
  /** Null when the account has no profile row yet; the caller then creates it as before. */
  profile: UserDocument | null;
};

/**
 * Returns `null` when the backend does not implement the action yet
 * (pre-deploy: 501 from a function that never registered it, 404 from an older
 * one), so the caller falls back to its existing direct read. A transient
 * network failure is retried once; any other failure propagates, because a real
 * error must not be silently treated as "not deployed".
 */
export const fetchProfileBootstrap = async (
  call: <T>(action: string) => Promise<T>,
  action: ProfileBootstrapAction
): Promise<ProfileBootstrap | null> => {
  let response: { profile?: Record<string, unknown> | null };

  try {
    response = await retryOnceOnTransientFailure(() => call<{ profile?: Record<string, unknown> | null }>(action));
  } catch (error) {
    if (isBackendRpcError(error) && (error.status === 501 || error.status === 404)) {
      return null;
    }
    throw error;
  }

  return { profile: response?.profile ? mapUserProfileRecord(response.profile as Record<string, any>) : null };
};
