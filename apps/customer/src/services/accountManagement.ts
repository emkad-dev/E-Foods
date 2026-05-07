import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase/config';

const deleteOwnAccountCallable = httpsCallable<undefined, { deleted: boolean; targetUid: string }>(
  functions,
  'deleteOwnAccount'
);

export const deleteOwnAccount = async () => {
  const result = await deleteOwnAccountCallable();
  return result.data;
};
