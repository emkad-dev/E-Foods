import { callDispatchBackendRpc } from './backendRpc';
import type { PolicyAcceptancePayload } from '../../../../packages/domain/src';

export type DispatchApplicationInput = {
  currentAddress?: string;
  displayName: string;
  licenceBackBase64: string;
  licenceBackMimeType?: string;
  licenceFrontBase64: string;
  licenceFrontMimeType?: string;
  licenseNumber: string;
  lga: string;
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlateNumber: string;
  phoneNumber: string;
  policyAcceptance?: PolicyAcceptancePayload;
  region: string;
  vehicleType: string;
};

export const submitDispatchApplication = async (input: DispatchApplicationInput) =>
  callDispatchBackendRpc<{
    status: 'pending';
    submittedAt: string;
    targetUid: string;
  }>('submitDispatchApplication', input);
