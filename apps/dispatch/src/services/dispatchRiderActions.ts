import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

export type DispatchRiderDraft = {
  acceptanceRate: number | null;
  activeLoad: number;
  completedTrips: number;
  latitude?: number | null;
  longitude?: number | null;
  name: string;
  status: string;
  vehicleType: string;
  zone: string;
};

const upsertDispatchRiderProfileCallable = httpsCallable<
  DispatchRiderDraft & { riderId?: string },
  { rider: Record<string, unknown> }
>(functions, 'upsertDispatchRiderProfile');

export const createDispatchRider = async (draft: DispatchRiderDraft) => {
  await upsertDispatchRiderProfileCallable(draft);
};

export const updateDispatchRider = async (riderId: string, draft: DispatchRiderDraft) => {
  await upsertDispatchRiderProfileCallable({
    riderId,
    ...draft,
  });
};
