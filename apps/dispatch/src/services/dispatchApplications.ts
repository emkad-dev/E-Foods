import { callDispatchBackendRpc } from './backendRpc';

export type DispatchApplicationInput = {
  currentAddress?: string;
  displayName: string;
  lga: string;
  phoneNumber: string;
  region: string;
  vehicleType: string;
};

export const submitDispatchApplication = async (input: DispatchApplicationInput) =>
  callDispatchBackendRpc<{
    status: 'pending';
    submittedAt: string;
    targetUid: string;
  }>('submitDispatchApplication', input);
