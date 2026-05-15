import { callDispatchBackendRpc } from './backendRpc';

export type DispatchRiderDraft = {
  acceptanceRate: number | null;
  activeLoad: number;
  completedTrips: number;
  lga: string;
  name: string;
  status: string;
  vehicleType: string;
  zone: string;
};

export const createDispatchRider = async (draft: DispatchRiderDraft) => {
  await callDispatchBackendRpc('upsertDispatchRiderProfile', draft);
};

export const updateDispatchRider = async (riderId: string, draft: DispatchRiderDraft) => {
  await callDispatchBackendRpc('upsertDispatchRiderProfile', {
    riderId,
    ...draft,
  });
};
