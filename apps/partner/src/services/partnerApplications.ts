import { callPartnerBackendRpc } from './backendRpc';
import type { PolicyAcceptancePayload } from '../../../../packages/domain/src';

export type PartnerApplicationInput = {
  accountNumber?: string | null;
  address: string;
  bankCode?: string | null;
  bankName?: string | null;
  contactName: string;
  cuisine: string;
  deliveryRadiusKm?: number | null;
  deliveryTime?: string;
  description?: string;
  documentBackPath?: string | null;
  documentFrontPath?: string | null;
  documentType?: string | null;
  latitude?: number | null;
  legalName?: string | null;
  logoImage?: string | null;
  longitude?: number | null;
  phoneNumber: string;
  policyAcceptance?: PolicyAcceptancePayload;
  restaurantName: string;
};

export const submitPartnerApplication = async (input: PartnerApplicationInput) =>
  callPartnerBackendRpc<{
    status: 'pending';
    submittedAt: string;
    restaurantId: string;
    targetUid: string;
  }>('submitPartnerApplication', input);
