import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase/config';

export type DispatchRiderDraft = {
  acceptanceRate: number | null;
  activeLoad: number;
  completedTrips: number;
  name: string;
  status: string;
  vehicleType: string;
  zone: string;
};

export const createDispatchRider = async (draft: DispatchRiderDraft) => {
  await addDoc(collection(db, 'dispatchProfiles'), {
    acceptanceRate: 85,
    activeLoad: draft.activeLoad,
    completedTrips: draft.completedTrips,
    createdAt: serverTimestamp(),
    displayName: draft.name,
    status: draft.status,
    updatedAt: serverTimestamp(),
    vehicleType: draft.vehicleType,
    zone: draft.zone,
  });
};

export const updateDispatchRider = async (riderId: string, draft: DispatchRiderDraft) => {
  await updateDoc(doc(db, 'dispatchProfiles', riderId), {
    acceptanceRate: 85,
    activeLoad: draft.activeLoad,
    completedTrips: draft.completedTrips,
    displayName: draft.name,
    status: draft.status,
    updatedAt: serverTimestamp(),
    vehicleType: draft.vehicleType,
    zone: draft.zone,
  });
};
