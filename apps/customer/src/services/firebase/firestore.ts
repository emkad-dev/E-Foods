// src/services/firebase/firestore.ts
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  getDocs,
  deleteDoc,
  QueryConstraint,
  DocumentData,
} from 'firebase/firestore';

export interface User extends DocumentData {
  uid: string;
  email: string;
  role: 'customer' | 'restaurant' | 'dispatch';
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
  activeSessionId?: string | null;
  activeSessionUpdatedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Restaurant extends DocumentData {
  id: string;
  name: string;
  description?: string;
  image?: string;
  rating?: number;
  deliveryTime?: number;
  minOrder?: number;
  deliveryFee?: number;
  address?: string;
  createdAt: string;
}

/**
 * Get user document from Firestore
 */
export const getUserDocument = async (
  db: Firestore,
  userId: string
): Promise<User | null> => {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      return userDoc.data() as User;
    }
    return null;
  } catch (error) {
    console.error('Error fetching user document:', error);
    throw error;
  }
};

/**
 * Create a new user document in Firestore
 */
export const createUserDocument = async (
  db: Firestore,
  userId: string,
  userData: Partial<User>
): Promise<void> => {
  try {
    const { role: _ignoredRole, ...safeUserData } = userData;
    const userDoc: User = {
      uid: userId,
      email: safeUserData.email || '',
      role: 'customer',
      emailVerified: safeUserData.emailVerified || false,
      displayName: safeUserData.displayName,
      photoURL: safeUserData.photoURL,
      createdAt: new Date().toISOString(),
      ...safeUserData,
    };

    await setDoc(doc(db, 'users', userId), userDoc);
  } catch (error) {
    console.error('Error creating user document:', error);
    throw error;
  }
};

/**
 * Update user document in Firestore
 */
export const updateUserDocument = async (
  db: Firestore,
  userId: string,
  updates: Partial<User>
): Promise<void> => {
  try {
    const {
      role: _ignoredRole,
      restaurantId: _ignoredRestaurantId,
      restaurantName: _ignoredRestaurantName,
      restaurantLinkedAt: _ignoredRestaurantLinkedAt,
      restaurantLinkSource: _ignoredRestaurantLinkSource,
      ...safeUpdates
    } = updates as Partial<User> & {
      restaurantId?: string;
      restaurantName?: string;
      restaurantLinkedAt?: string;
      restaurantLinkSource?: string;
    };
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating user document:', error);
    throw error;
  }
};

/**
 * Query users by a specific field
 */
export const queryUsers = async (
  db: Firestore,
  ...constraints: QueryConstraint[]
): Promise<User[]> => {
  try {
    const q = query(collection(db, 'users'), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map((doc) => doc.data() as User);
  } catch (error) {
    console.error('Error querying users:', error);
    throw error;
  }
};

/**
 * Delete user document from Firestore
 */
export const deleteUserDocument = async (
  db: Firestore,
  userId: string
): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'users', userId));
  } catch (error) {
    console.error('Error deleting user document:', error);
    throw error;
  }
};

/**
 * Get generic document from Firestore
 */
export const getDocument = async (
  db: Firestore,
  collectionName: string,
  docId: string
): Promise<DocumentData | null> => {
  try {
    const docSnap = await getDoc(doc(db, collectionName, docId));
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.error(`Error fetching document from ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Set generic document in Firestore
 */
export const setDocument = async (
  db: Firestore,
  collectionName: string,
  docId: string,
  data: DocumentData
): Promise<void> => {
  try {
    await setDoc(doc(db, collectionName, docId), data);
  } catch (error) {
    console.error(`Error setting document in ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Update generic document in Firestore
 */
export const updateDocument = async (
  db: Firestore,
  collectionName: string,
  docId: string,
  updates: DocumentData
): Promise<void> => {
  try {
    const docRef = doc(db, collectionName, docId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error updating document in ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Query generic documents from Firestore
 */
export const queryDocuments = async (
  db: Firestore,
  collectionName: string,
  ...constraints: QueryConstraint[]
): Promise<DocumentData[]> => {
  try {
    const q = query(collection(db, collectionName), ...constraints);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    }));
  } catch (error) {
    console.error(`Error querying documents from ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Delete generic document from Firestore
 */
export const deleteDocument = async (
  db: Firestore,
  collectionName: string,
  docId: string
): Promise<void> => {
  try {
    await deleteDoc(doc(db, collectionName, docId));
  } catch (error) {
    console.error(`Error deleting document from ${collectionName}:`, error);
    throw error;
  }
};
