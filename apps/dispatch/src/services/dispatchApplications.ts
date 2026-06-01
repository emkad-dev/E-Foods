import { callDispatchBackendRpc } from './backendRpc';
import type { PolicyAcceptancePayload } from '../../../../packages/domain/src';

export type DispatchApplicationInput = {
  currentAddress?: string;
  displayName: string;
  lga: string;
  phoneNumber: string;
  policyAcceptance?: PolicyAcceptancePayload;
  region: string;
  vehicleType: string;
};

export const submitDispatchApplication = async (input: DispatchApplicationInput) =>
  callDispatchBackendRpc<{
    status: 'approved';
    submittedAt: string;
    targetUid: string;
  }>('submitDispatchApplication', input);
