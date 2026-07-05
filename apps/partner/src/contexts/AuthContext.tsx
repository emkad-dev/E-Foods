import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { UserDocument } from '../domain/entities';
import { appEnv } from '../config/env';
import {
  createUserWithEmail,
  formatAuthError,
  getUserRoleClaim,
  sendVerificationEmail,
  signInWithEmail,
  signOutUser,
  sendPasswordReset,
} from '../services/supabase/auth';
import { supabase } from '../services/supabase/config';
import {
  clearStoredUserProfile,
  clearStoredSessionId,
  createSessionId,
  getStoredUserProfile,
  getStoredSessionId,
  storeSessionId,
  storeUserProfile,
} from '../services/session';
import { linkPartnerRestaurant } from '../services/partnerRestaurantActions';
import { submitPartnerApplication, type PartnerApplicationInput } from '../services/partnerApplications';
import { uploadRestaurantAsset } from '../services/restaurantAssetUpload';
import { createUserDocument, getUserDocument, updateUserDocument } from '../services/supabase/profile';
import { deleteOwnAccount as deleteOwnPartnerAccount } from '../services/accountManagement';

type AuthContextType = {
  user: UserDocument | null;
  loading: boolean;
  error: string | null;
  signUp: (
    email: string,
    password: string,
    userData: PartnerApplicationInput
  ) => Promise<{ verificationEmailSent: boolean }>;
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
const SESSION_CONFLICT_ERROR =
  'This account was signed in on another device. Sign in again here if you want to continue on this device.';
const PARTNER_APPLICATION_READY_MESSAGE =
  'Your restaurant account is live. Sign in again after you verify your email.';
const PARTNER_APPLICATION_REJECTED_FALLBACK =
  'Your restaurant account is not active yet. Update your details with the operations team before trying again.';
const PARTNER_SIGNUP_ROLLBACK_ERROR =
  'Your restaurant application could not be completed and the temporary account could not be fully removed. Try again with a stable connection or contact the onboarding team.';
const getActionCodeSettings = (path: string) => ({
  url: `${appEnv.appScheme}://${path}`,
});

const isProfileOfflineError = (error: unknown) => {
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
  if (isProfileOfflineError(error)) {
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
    return 'Your restaurant account is being prepared. Sign in again shortly.';
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
      await deleteOwnPartnerAccount();
      await signOutUser(supabase).catch(() => undefined);
      await clearLocalUserState();
      setUser(null);
      return true;
    } catch (rollbackError) {
      console.error('Failed to rollback partner applicant signup:', rollbackError);
      await clearLocalUserState();
      setUser(null);
      return false;
    }
  }, [clearLocalUserState]);

  const startSingleDeviceSession = useCallback(async (userId: string) => {
    const sessionId = createSessionId();

    await updateUserDocument(userId, {
      activeSessionId: sessionId,
      activeSessionUpdatedAt: new Date().toISOString(),
    });
    await storeSessionId(sessionId);
  }, []);

  const releaseSingleDeviceSession = useCallback(async (userId?: string | null) => {
    const localSessionId = await getStoredSessionId();

    try {
      if (userId && localSessionId) {
        const userDocument = await getUserDocument(userId);

        if (userDocument?.activeSessionId === localSessionId) {
          await updateUserDocument(userId, {
            activeSessionId: null,
            activeSessionUpdatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (releaseError) {
      if (!isProfileOfflineError(releaseError)) {
        console.warn('Unable to release partner session in Supabase:', releaseError);
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
      await signOutUser(supabase);
      setUser(null);
      setError(SESSION_CONFLICT_ERROR);
      return false;
    }

    if (!localSessionId && remoteSessionId) {
      await storeSessionId(remoteSessionId);
    }

    return true;
  }, [clearLocalUserState]);

  const buildNextUser = useCallback(
    async (authUser: SupabaseAuthUser) => {
      const claimRole = await getUserRoleClaim(authUser);
      const userDocument = await getUserDocument(authUser.id);

      if (claimRole !== 'restaurant') {
        if (pendingApplicantUidRef.current === authUser.id) {
          return null;
        }

        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(getPartnerAccessStateMessage(userDocument));
        return null;
      }

      if (!userDocument) {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(MISSING_PROFILE_ERROR);
        return null;
      }

      return {
        ...userDocument,
        uid: authUser.id,
        email: authUser.email ?? userDocument.email,
        emailVerified: Boolean(authUser.email_confirmed_at),
        role: claimRole,
      } satisfies UserDocument;
    },
    [clearLocalUserState]
  );

  // First paint must not wait on the sequential auth RPCs (role claim,
  // getUserDocument, single-device sync) that follow onAuthStateChange — on a
  // slow network those round-trips can hold the app on a spinner for seconds.
  // Instead we resolve the first frame from local storage only: paint the
  // cached partner profile if we have one, or show the login screen straight
  // away when there is no Supabase session. The onAuthStateChange listener then
  // reconciles the real state in the background.
  useEffect(() => {
    let active = true;

    void (async () => {
      const cachedUser = await getStoredUserProfile<UserDocument>();

      if (!active) {
        return;
      }

      if (cachedUser && cachedUser.role === 'restaurant') {
        setUser(cachedUser);
        setLoading(false);
        return;
      }

      // No cached profile: getSession() is a local read (no network), so we can
      // cheaply decide whether to unblock straight to the login screen. When a
      // session does exist we leave `loading` true and let the reconcile below
      // finish, since there is nothing cached to paint yet.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (active && !session) {
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      // Background reconciliation (INITIAL_SESSION, TOKEN_REFRESHED, …) must not
      // re-block the UI once the first paint has resolved. Only an explicit
      // sign-in returns to the full-screen spinner.
      if (event === 'SIGNED_IN') {
        setLoading(true);
      }

      try {
        const authUser = session?.user ?? null;

        if (!authUser) {
          setUser(null);
          await clearLocalUserState();
          return;
        }

        const nextUser = await buildNextUser(authUser);

        if (!nextUser) {
          return;
        }

        const sessionIsValid = await syncSingleDeviceSession(nextUser);

        if (!sessionIsValid) {
          return;
        }

        setUser(nextUser);
        await storeUserProfile(nextUser);
      } catch (nextError) {
        const authUser = session?.user ?? null;
        if (authUser && isProfileOfflineError(nextError)) {
          const cachedUser = await getStoredUserProfile<UserDocument>();

          if (cachedUser?.uid === authUser.id && cachedUser.role === 'restaurant') {
            const fallbackUser: UserDocument = {
              ...cachedUser,
              uid: authUser.id,
              email: authUser.email ?? cachedUser.email,
              emailVerified: Boolean(authUser.email_confirmed_at),
              role: 'restaurant',
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

    return () => subscription.unsubscribe();
  }, [buildNextUser, clearLocalUserState, syncSingleDeviceSession]);

  const signUp = async (email: string, password: string, userData: PartnerApplicationInput) => {
    setLoading(true);
    setError(null);
    let applicantUid: string | null = null;

    try {
      const authUser = await createUserWithEmail(supabase, email, password);
      applicantUid = authUser.id;
      pendingApplicantUidRef.current = authUser.id;

      await createUserDocument(authUser.id, {
        email: authUser.email ?? email,
        emailVerified: Boolean(authUser.email_confirmed_at),
        role: 'customer',
      });

      const logoImage = userData.logoImage
        ? await uploadRestaurantAsset({
            kind: 'logos',
            ownerId: authUser.id,
            uri: userData.logoImage,
          })
        : null;

      await submitPartnerApplication({
        address: userData.address.trim(),
        contactName: userData.contactName.trim(),
        cuisine: userData.cuisine.trim(),
        deliveryTime: userData.deliveryTime?.trim() || undefined,
        description: userData.description?.trim() || undefined,
        latitude: userData.latitude ?? null,
        logoImage,
        longitude: userData.longitude ?? null,
        phoneNumber: userData.phoneNumber.trim(),
        restaurantName: userData.restaurantName.trim(),
      });

      let verificationEmailSent = false;

      try {
        await sendVerificationEmail(
          supabase,
          authUser.email ?? email,
          getActionCodeSettings(appEnv.verifyEmailPath)
        );
        verificationEmailSent = true;
      } catch (verificationError) {
        console.warn('Partner account created, but verification email could not be sent:', verificationError);
      }

      await clearLocalUserState();
      await signOutUser(supabase);
      setUser(null);
      setError(PARTNER_APPLICATION_READY_MESSAGE);
      return { verificationEmailSent };
    } catch (nextError: any) {
      let resolvedMessage =
        nextError?.message === PARTNER_APPLICATION_READY_MESSAGE
          ? PARTNER_APPLICATION_READY_MESSAGE
          : getPartnerAuthErrorMessage(nextError, 'Unable to sign up');

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
      const authUser = await signInWithEmail(supabase, email, password);
      const claimRole = await getUserRoleClaim(authUser);

      if (claimRole !== 'restaurant') {
        const userDocument = await getUserDocument(authUser.id);
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        const nextMessage = getPartnerAccessStateMessage(userDocument);
        setError(nextMessage);
        throw new Error(nextMessage);
      }

      const userDocument = await getUserDocument(authUser.id);

      if (!userDocument) {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(MISSING_PROFILE_ERROR);
        throw new Error(MISSING_PROFILE_ERROR);
      }

      await startSingleDeviceSession(authUser.id);
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
      await sendPasswordReset(supabase, email, getActionCodeSettings(appEnv.resetPasswordPath));
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
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      await releaseSingleDeviceSession(authUser?.id);
      await signOutUser(supabase);
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
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      const message = 'No user is currently signed in';
      setError(message);
      throw new Error(message);
    }

    setLoading(true);
    setError(null);

    try {
      await deleteOwnPartnerAccount();
      await signOutUser(supabase).catch(() => undefined);
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
