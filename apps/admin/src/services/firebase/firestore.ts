import { doc, getDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { UserDocument } from '../../domain/entities';

export const getUserDocument = async (db: Firestore, userId: string): Promise<UserDocument | null> => {
  const userSnapshot = await getDoc(doc(db, 'users', userId));

  if (!userSnapshot.exists()) {
    return null;
  }

  return userSnapshot.data() as UserDocument;
};

export const updateUserDocument = async (
  db: Firestore,
  userId: string,
  updates: Partial<UserDocument>
): Promise<void> => {
  const currentSnapshot = await getDoc(doc(db, 'users', userId));
  if (!currentSnapshot.exists()) {
    throw new Error('Admin profile does not exist. Ask the platform team to provision this account before updating it.');
  }

  await updateDoc(doc(db, 'users', userId), {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
};
