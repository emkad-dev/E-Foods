import type { UserDocument } from '../domain/entities';
import { isBackendRpcError } from '../../../../packages/auth/src';
import { callCustomerBackendRpc } from './backendRpc';
import { mapProfile } from './supabase/profile';

type PolicyAcceptanceStatus = {
  accepted: boolean;
  acceptedAt?: string | null;
  privacyVersion: string;
  termsVersion: string;
};

type CustomerBootstrapResponse = {
  profile: Record<string, unknown> | null;
  policyAcceptance: PolicyAcceptanceStatus;
  activeSessionId: string | null;
};

export type CustomerBootstrap = {
  profile: UserDocument | null;
  policyAccepted: boolean;
  activeSessionId: string | null;
};

/**
 * Collapses the interactive-sign-in reads into one authenticated call:
 * profile, policy acceptance and the remote activeSessionId. Returns `null`
 * when the backend does not implement the action yet (pre-deploy), so the
 * caller can fall back to the individual RPC chain. Any other failure
 * propagates — a real error must not be silently treated as "not deployed".
 */
export const fetchCustomerBootstrap = async (): Promise<CustomerBootstrap | null> => {
  let response: CustomerBootstrapResponse;

  try {
    response = await callCustomerBackendRpc<CustomerBootstrapResponse>('customerBootstrap');
  } catch (error) {
    // 501 = action not implemented in the deployed backend; 404 = older
    // function that never registered it. Either means "fall back to the old
    // chain", nothing more.
    if (isBackendRpcError(error) && (error.status === 501 || error.status === 404)) {
      return null;
    }
    throw error;
  }

  return {
    profile: response.profile ? mapProfile(response.profile as Record<string, any>) : null,
    policyAccepted: response.policyAcceptance?.accepted === true,
    activeSessionId: typeof response.activeSessionId === 'string' ? response.activeSessionId : null,
  };
};
