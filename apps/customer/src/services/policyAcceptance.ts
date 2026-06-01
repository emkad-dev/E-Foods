import {
  buildPolicyAcceptancePayload,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  type PolicyAcceptancePayload,
} from '../../../../packages/domain/src';
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

export const getCustomerPolicyAcceptance = async () =>
  callCustomerBackendRpc<PolicyAcceptanceStatus>('getPolicyAcceptance', {
    app: 'customer',
  });

export const recordCustomerPolicyAcceptance = async (source = 'customer_policy_gate') =>
  callCustomerBackendRpc<PolicyAcceptanceStatus>('recordPolicyAcceptance', buildCustomerPolicyAcceptance(source));
