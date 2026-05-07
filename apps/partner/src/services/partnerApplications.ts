import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

export type PartnerApplicationInput = {
  address: string;
  contactName: string;
  cuisine: string;
  deliveryTime?: string;
  description?: string;
  latitude?: number | null;
  longitude?: number | null;
  phoneNumber: string;
  restaurantName: string;
};

const submitPartnerApplicationCallable = httpsCallable<
  PartnerApplicationInput,
  {
    status: 'pending';
    submittedAt: string;
    targetUid: string;
  }
>(functions, 'submitPartnerApplication');

export const submitPartnerApplication = async (input: PartnerApplicationInput) => {
  const result = await submitPartnerApplicationCallable(input);
  return result.data;
};
