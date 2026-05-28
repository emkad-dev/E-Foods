import { callPartnerBackendRpc } from './backendRpc';

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
  restaurantName: string;
};

export const submitPartnerApplication = async (input: PartnerApplicationInput) =>
  callPartnerBackendRpc<{
    status: 'pending';
    submittedAt: string;
    targetUid: string;
  }>('submitPartnerApplication', input);
