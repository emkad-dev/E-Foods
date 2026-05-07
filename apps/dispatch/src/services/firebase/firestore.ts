import { doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { UserDocument } from '../../domain/entities';

export const getUserDocument = async (db: Firestore, userId: string): Promise<UserDocument | null> => {
  const userSnapshot = await getDoc(doc(db, 'users', userId));

  if (!userSnapshot.exists()) {
    return null;
  }

  return userSnapshot.data() as UserDocument;
};

export const createUserDocument = async (
  db: Firestore,
  userId: string,
  userData: Partial<UserDocument>
): Promise<void> => {
  const { role: requestedRole, ...safeUserData } = userData;

  if (requestedRole && requestedRole !== 'dispatch') {
    throw new Error('Dispatch profiles must be provisioned with the dispatch role.');
  }

  const userDocument: UserDocument = {
    uid: userId,
    email: safeUserData.email || '',
    role: 'dispatch',
    emailVerified: safeUserData.emailVerified || false,
    displayName: safeUserData.displayName,
    photoURL: safeUserData.photoURL,
    createdAt: new Date().toISOString(),
    ...safeUserData,
  };

  await setDoc(doc(db, 'users', userId), userDocument);
};

export const updateUserDocument = async (
  db: Firestore,
  userId: string,
  updates: Partial<UserDocument>
): Promise<void> => {
  const currentSnapshot = await getDoc(doc(db, 'users', userId));
  if (!currentSnapshot.exists()) {
    throw new Error('Dispatch profile does not exist. Ask an admin to provision this account before updating it.');
  }

  await updateDoc(doc(db, 'users', userId), {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
};
