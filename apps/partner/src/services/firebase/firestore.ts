import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
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
  const userDocument: UserDocument = {
    uid: userId,
    email: userData.email || '',
    role: userData.role || 'restaurant',
    emailVerified: userData.emailVerified || false,
    displayName: userData.displayName,
    photoURL: userData.photoURL,
    createdAt: new Date().toISOString(),
    ...userData,
  };

  await setDoc(doc(db, 'users', userId), userDocument);
};

export const updateUserDocument = async (
  db: Firestore,
  userId: string,
  updates: Partial<UserDocument>
): Promise<void> => {
  const currentSnapshot = await getDoc(doc(db, 'users', userId));
  const currentData = currentSnapshot.exists() ? (currentSnapshot.data() as UserDocument) : null;

  await setDoc(
    doc(db, 'users', userId),
    {
      ...(currentData ?? {
        uid: userId,
        email: updates.email ?? '',
        role: updates.role ?? 'restaurant',
        emailVerified: updates.emailVerified ?? false,
        createdAt: new Date().toISOString(),
      }),
      ...updates,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
};
