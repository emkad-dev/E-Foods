import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

export type DispatchApplicationInput = {
  currentAddress?: string;
  displayName: string;
  latitude: number;
  longitude: number;
  phoneNumber: string;
  region: string;
  vehicleType: string;
};

const submitDispatchApplicationCallable = httpsCallable<
  DispatchApplicationInput,
  {
    status: 'pending';
    submittedAt: string;
    targetUid: string;
  }
>(functions, 'submitDispatchApplication');

export const submitDispatchApplication = async (input: DispatchApplicationInput) => {
  const result = await submitDispatchApplicationCallable(input);
  return result.data;
};
