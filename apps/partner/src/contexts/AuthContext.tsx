import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { UserDocument } from '../domain/entities';
import {
  createUserWithEmail,
  deleteUserAccount,
  formatAuthError,
  getUserRoleClaim,
  sendPasswordReset,
  signInWithEmail,
  signOutUser,
} from '../services/firebase/auth';
import { auth, db } from '../services/firebase/config';
import {
  clearStoredUserProfile,
  clearStoredSessionId,
  createSessionId,
  getStoredUserProfile,
  getStoredSessionId,
  storeSessionId,
  storeUserProfile,
} from '../services/firebase/session';
import { linkPartnerRestaurant } from '../services/partnerRestaurantActions';
import { submitPartnerApplication, type PartnerApplicationInput } from '../services/partnerApplications';
import { getUserDocument, updateUserDocument } from '../services/firebase/firestore';
import { deleteOwnAccount as deleteOwnPartnerAccount } from '../services/accountManagement';

type AuthContextType = {
  user: UserDocument | null;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string, userData: PartnerApplicationInput) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  linkRestaurant: (restaurantId: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PARTNER_ACCESS_ERROR = 'This account does not have partner access.';
const MISSING_PROFILE_ERROR = 'No partner profile was found for this account.';
const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const SESSION_CONFLICT_ERROR = 'This account was signed in on another device. Sign in again here if you want to continue on this device.';
const PARTNER_APPLICATION_PENDING_MESSAGE =
  'Your restaurant application has been submitted. Wait for admin approval before signing into the partner dashboard.';
const PARTNER_APPLICATION_REJECTED_FALLBACK =
  'Your restaurant application was reviewed but not approved yet. Update your details with the onboarding team before trying again.';
const PARTNER_SIGNUP_ROLLBACK_ERROR =
  'Your restaurant application could not be completed and the temporary account could not be fully removed. Try again with a stable connection or contact the onboarding team.';

const isFirestoreOfflineError = (error: unknown) => {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String((error as any).code) : '';
  const errorMessage =
    typeof error === 'object' && error !== null && 'message' in error ? String((error as any).message).toLowerCase() : '';

  return (
    errorCode === 'unavailable' ||
    errorCode === 'failed-precondition' ||
    errorMessage.includes('client is offline') ||
    errorMessage.includes('offline')
  );
};

const getPartnerAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (isFirestoreOfflineError(error)) {
    return NO_INTERNET_ERROR;
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    return formatAuthError(error);
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as any).message ?? fallbackMessage);
  }

  return fallbackMessage;
};

const getPartnerAccessStateMessage = (userDocument: Partial<UserDocument> | null) => {
  if (!userDocument) {
    return MISSING_PROFILE_ERROR;
  }

  if (userDocument.partnerApplicationStatus === 'pending') {
    return PARTNER_APPLICATION_PENDING_MESSAGE;
  }

  if (userDocument.partnerApplicationStatus === 'rejected') {
    return userDocument.partnerApplicationRejectionReason ?? PARTNER_APPLICATION_REJECTED_FALLBACK;
  }

  return PARTNER_ACCESS_ERROR;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pendingApplicantUidRef = useRef<string | null>(null);

  const clearLocalUserState = useCallback(async () => {
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile()]);
  }, []);

  const rollbackPendingApplicant = useCallback(async (userId: string) => {
    pendingApplicantUidRef.current = null;

    try {
      const currentUser = auth.currentUser;

      if (currentUser?.uid === userId) {
        await deleteUserAccount(currentUser);
      } else if (currentUser) {
        await signOutUser(auth);
      }

      await clearLocalUserState();
      setUser(null);
      return true;
    } catch (rollbackError) {
      console.error('Failed to rollback partner applicant signup:', rollbackError);

      try {
        if (auth.currentUser?.uid === userId) {
          await signOutUser(auth);
        }
      } catch (signOutError) {
        console.error('Failed to sign out after partner signup rollback error:', signOutError);
      }

      await clearLocalUserState();
      setUser(null);
      return false;
    }
  }, [clearLocalUserState]);

  const startSingleDeviceSession = useCallback(async (userId: string) => {
    const sessionId = createSessionId();

    await updateUserDocument(db, userId, {
      activeSessionId: sessionId,
      activeSessionUpdatedAt: new Date().toISOString(),
    });
    await storeSessionId(sessionId);
  }, []);

  const releaseSingleDeviceSession = useCallback(async (userId?: string | null) => {
    const localSessionId = await getStoredSessionId();

    try {
      if (userId && localSessionId) {
        const userDocument = await getUserDocument(db, userId);

        if (userDocument?.activeSessionId === localSessionId) {
          await updateUserDocument(db, userId, {
            activeSessionId: null,
            activeSessionUpdatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (releaseError) {
      if (!isFirestoreOfflineError(releaseError)) {
        console.warn('Unable to release partner session in Firestore:', releaseError);
      }
    } finally {
      await clearStoredSessionId();
    }
  }, []);

  const syncSingleDeviceSession = useCallback(async (userDocument: UserDocument) => {
    const localSessionId = await getStoredSessionId();
    const remoteSessionId = userDocument.activeSessionId ?? null;

    if (localSessionId && remoteSessionId && localSessionId !== remoteSessionId) {
      await clearLocalUserState();
      await signOutUser(auth);
      setUser(null);
      setError(SESSION_CONFLICT_ERROR);
      return false;
    }

    if (!localSessionId && remoteSessionId) {
      await storeSessionId(remoteSessionId);
    }

    return true;
  }, [clearLocalUserState]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);

      try {
        if (!firebaseUser) {
          setUser(null);
          await clearLocalUserState();
          return;
        }

        const claimRole = await getUserRoleClaim(firebaseUser);
        if (claimRole !== 'restaurant') {
          if (pendingApplicantUidRef.current === firebaseUser.uid) {
            return;
          }

          const userDocument = await getUserDocument(db, firebaseUser.uid);

          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          setError(getPartnerAccessStateMessage(userDocument));
          return;
        }

        const userDocument = await getUserDocument(db, firebaseUser.uid);

        if (!userDocument) {
          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          setError(MISSING_PROFILE_ERROR);
          return;
        }

        const sessionIsValid = await syncSingleDeviceSession(userDocument);

        if (!sessionIsValid) {
          return;
        }

        const nextUser: UserDocument = {
          ...userDocument,
          email: firebaseUser.email ?? userDocument.email,
          emailVerified: firebaseUser.emailVerified,
          role: claimRole,
        };

        setUser(nextUser);
        await storeUserProfile(nextUser);
      } catch (nextError) {
        if (firebaseUser && isFirestoreOfflineError(nextError)) {
          const cachedUser = await getStoredUserProfile<UserDocument>();

          if (cachedUser?.uid === firebaseUser.uid && cachedUser.role === 'restaurant') {
            const fallbackUser: UserDocument = {
              ...cachedUser,
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? cachedUser.email,
              emailVerified: firebaseUser.emailVerified,
            };

            const sessionIsValid = await syncSingleDeviceSession(fallbackUser);

            if (sessionIsValid) {
              setUser(fallbackUser);
              setError(NO_INTERNET_ERROR);
              return;
            }
          }
        }

        const nextMessage = getPartnerAuthErrorMessage(nextError, 'Failed to load partner account');
        console.error('Error syncing partner auth state:', nextError);
        setUser(null);
        setError(nextMessage);
        await clearStoredUserProfile();
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [clearLocalUserState, syncSingleDeviceSession]);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      async (userSnapshot) => {
        if (!userSnapshot.exists()) {
          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          return;
        }

        const nextUser = userSnapshot.data() as UserDocument;
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) {
          await clearLocalUserState();
          setUser(null);
          return;
        }

        const claimRole = await getUserRoleClaim(currentFirebaseUser);
        if (claimRole !== 'restaurant') {
          await clearLocalUserState();
          await signOutUser(auth);
          setUser(null);
          setError(getPartnerAccessStateMessage(nextUser));
          return;
        }

        const sessionIsValid = await syncSingleDeviceSession(nextUser);

        if (!sessionIsValid) {
          return;
        }

        setUser((currentUser) => {
          if (!currentUser) {
            return currentUser;
          }

          const resolvedUser = {
            ...currentUser,
            ...nextUser,
            email: auth.currentUser?.email ?? nextUser.email,
            emailVerified: auth.currentUser?.emailVerified ?? nextUser.emailVerified,
            role: claimRole,
          };

          void storeUserProfile(resolvedUser);
          return resolvedUser;
        });
      },
      (snapshotError) => {
        if (isFirestoreOfflineError(snapshotError)) {
          setError(NO_INTERNET_ERROR);
          return;
        }

        console.error('Error watching partner session:', snapshotError);
      }
    );

    return unsubscribe;
  }, [clearLocalUserState, syncSingleDeviceSession, user?.uid]);

  const signUp = async (email: string, password: string, userData: PartnerApplicationInput) => {
    setLoading(true);
    setError(null);
    let applicantUid: string | null = null;

    try {
      const firebaseUser = await createUserWithEmail(auth, email, password);
      applicantUid = firebaseUser.uid;
      pendingApplicantUidRef.current = firebaseUser.uid;

      await submitPartnerApplication({
        address: userData.address.trim(),
        contactName: userData.contactName.trim(),
        cuisine: userData.cuisine.trim(),
        deliveryTime: userData.deliveryTime?.trim() || undefined,
        description: userData.description?.trim() || undefined,
        latitude: userData.latitude ?? null,
        longitude: userData.longitude ?? null,
        phoneNumber: userData.phoneNumber.trim(),
        restaurantName: userData.restaurantName.trim(),
      });

      await clearLocalUserState();
      await signOutUser(auth);
      setUser(null);
      setError(PARTNER_APPLICATION_PENDING_MESSAGE);
    } catch (nextError: any) {
      const nextMessage =
        nextError?.message === PARTNER_APPLICATION_PENDING_MESSAGE
          ? PARTNER_APPLICATION_PENDING_MESSAGE
          : getPartnerAuthErrorMessage(nextError, 'Unable to sign up');
      let resolvedMessage = nextMessage;

      if (applicantUid) {
        const rollbackSucceeded = await rollbackPendingApplicant(applicantUid);

        if (!rollbackSucceeded) {
          resolvedMessage = PARTNER_SIGNUP_ROLLBACK_ERROR;
        }
      }

      setError(resolvedMessage);
      throw new Error(resolvedMessage);
    } finally {
      pendingApplicantUidRef.current = null;
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const firebaseUser = await signInWithEmail(auth, email, password);
      const claimRole = await getUserRoleClaim(firebaseUser);

      if (claimRole !== 'restaurant') {
        const userDocument = await getUserDocument(db, firebaseUser.uid);
        await clearLocalUserState();
        await signOutUser(auth);
        setUser(null);
        const nextMessage = getPartnerAccessStateMessage(userDocument);
        setError(nextMessage);
        throw new Error(nextMessage);
      }

      const userDocument = await getUserDocument(db, firebaseUser.uid);

      if (!userDocument) {
        await clearLocalUserState();
        await signOutUser(auth);
        setUser(null);
        setError(MISSING_PROFILE_ERROR);
        throw new Error(MISSING_PROFILE_ERROR);
      }

      await startSingleDeviceSession(firebaseUser.uid);
    } catch (nextError: any) {
      const nextMessage = getPartnerAuthErrorMessage(nextError, 'Unable to sign in');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    setLoading(true);
    setError(null);

    try {
      await sendPasswordReset(auth, email);
    } catch (nextError: any) {
      const nextMessage = getPartnerAuthErrorMessage(nextError, 'Unable to send password reset email');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const linkRestaurant = async (restaurantId: string) => {
    if (!user) {
      throw new Error('Sign in again to link a restaurant.');
    }

    setLoading(true);
    setError(null);

    try {
      const linkedRestaurant = await linkPartnerRestaurant(restaurantId);

      setUser((currentUser) => {
        if (!currentUser) {
          return currentUser;
        }

        const resolvedUser = {
          ...currentUser,
          restaurantId: linkedRestaurant.id,
          restaurantLinkedAt: new Date().toISOString(),
          restaurantLinkSource: 'partner_claim',
          restaurantName: linkedRestaurant.name,
          updatedAt: new Date().toISOString(),
        };

        void storeUserProfile(resolvedUser);
        return resolvedUser;
      });
    } catch (nextError: any) {
      const nextMessage = getPartnerAuthErrorMessage(nextError, 'Unable to link restaurant');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    setError(null);

    try {
      await releaseSingleDeviceSession(auth.currentUser?.uid);
      await signOutUser(auth);
      await clearLocalUserState();
      setUser(null);
    } catch (nextError: any) {
      const nextMessage = getPartnerAuthErrorMessage(nextError, 'Unable to sign out');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async () => {
    if (!auth.currentUser) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    setLoading(true);
    setError(null);

    try {
      await deleteOwnPartnerAccount();
      await signOutUser(auth).catch(() => undefined);
      await clearLocalUserState();
      setUser(null);
    } catch (nextError: any) {
      const nextMessage = getPartnerAuthErrorMessage(nextError, 'Unable to delete this account');
      setError(nextMessage);
      throw new Error(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => {
    setError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        signUp,
        signIn,
        resetPassword,
        linkRestaurant,
        signOut,
        deleteAccount,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};
