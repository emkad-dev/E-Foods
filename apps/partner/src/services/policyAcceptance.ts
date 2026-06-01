import {
  buildPolicyAcceptancePayload,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  type PolicyAcceptancePayload,
} from '../../../../packages/domain/src';

export const partnerPolicyVersions = {
  privacyVersion: CURRENT_PRIVACY_VERSION,
  termsVersion: CURRENT_TERMS_VERSION,
};

export const buildPartnerPolicyAcceptance = (source = 'partner_signup'): PolicyAcceptancePayload =>
  buildPolicyAcceptancePayload('partner', source);
