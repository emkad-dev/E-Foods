import {
  buildPolicyAcceptancePayload,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  type PolicyAcceptancePayload,
} from '../../../../packages/domain/src';
import type { BackendRpcOptions } from '../../../../packages/auth/src';
import { callCustomerBackendRpc } from './backendRpc';

type PolicyAcceptanceStatus = {
  accepted: boolean;
  acceptedAt?: string | null;
  privacyVersion: string;
  termsVersion: string;
};

export const customerPolicyVersions = {
  privacyVersion: CURRENT_PRIVACY_VERSION,
  termsVersion: CURRENT_TERMS_VERSION,
};

export const buildCustomerPolicyAcceptance = (source = 'customer_signup'): PolicyAcceptancePayload =>
  buildPolicyAcceptancePayload('customer', source);

// `options` is for the sign-in fallback's read, which passes an overall deadline
// so a stalled function cannot hold the sign-in screen. Every other caller omits
// it. Never pass it to recordCustomerPolicyAcceptance below: that is a write.
export const getCustomerPolicyAcceptance = async (options?: BackendRpcOptions) =>
  callCustomerBackendRpc<PolicyAcceptanceStatus>(
    'getPolicyAcceptance',
    {
      app: 'customer',
    },
    options
  );

export const recordCustomerPolicyAcceptance = async (source = 'customer_policy_gate') =>
  callCustomerBackendRpc<PolicyAcceptanceStatus>('recordPolicyAcceptance', buildCustomerPolicyAcceptance(source), {
    write: true,
  });
