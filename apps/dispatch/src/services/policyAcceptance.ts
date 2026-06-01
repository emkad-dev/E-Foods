import {
  buildPolicyAcceptancePayload,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  type PolicyAcceptancePayload,
} from '../../../../packages/domain/src';

export const dispatchPolicyVersions = {
  privacyVersion: CURRENT_PRIVACY_VERSION,
  termsVersion: CURRENT_TERMS_VERSION,
};

export const buildDispatchPolicyAcceptance = (source = 'dispatch_signup'): PolicyAcceptancePayload =>
  buildPolicyAcceptancePayload('dispatch', source);
