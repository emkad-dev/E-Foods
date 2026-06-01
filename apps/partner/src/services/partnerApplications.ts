import { callPartnerBackendRpc } from './backendRpc';
import type { PolicyAcceptancePayload } from '../../../../packages/domain/src';

export type PartnerApplicationInput = {
  address: string;
  contactName: string;
  cuisine: string;
  deliveryTime?: string;
  description?: string;
  latitude?: number | null;
  logoImage?: string | null;
  longitude?: number | null;
  phoneNumber: string;
  policyAcceptance?: PolicyAcceptancePayload;
  restaurantName: string;
};

export const submitPartnerApplication = async (input: PartnerApplicationInput) =>
  callPartnerBackendRpc<{
    status: 'approved';
    submittedAt: string;
    restaurantId: string;
    targetUid: string;
  }>('submitPartnerApplication', input);
