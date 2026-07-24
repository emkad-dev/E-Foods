import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { UserDocument } from '../domain/entities';
import { appEnv } from '../config/env';
import {
  createUserWithEmail,
  formatAuthError,
  getUserRoleClaim,
  isNetworkRequestError,
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
import { createUserDocument, getUserDocument, updateUserDocument } from '../services/supabase/profile';
import { deleteOwnAccount as deleteOwnPartnerAccount } from '../services/accountManagement';
import { shouldHydrateCachedUserProfile } from '../../../../packages/auth/src';

type AuthContextType = {
  user: UserDocument | null;
  loading: boolean;
  error: string | null;
  signUp: (
    email: string,
    password: string,
    userData: {
      contactName: string;
      phoneNumber: string;
    }
  ) => Promise<{ verificationEmailSent: boolean; sessionPresent: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  linkRestaurant: (restaurantId: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const MISSING_PROFILE_ERROR = 'No partner profile was found for this account.';
const NO_INTERNET_ERROR = 'No internet connection. Check your network and try again.';
const SESSION_CONFLICT_ERROR =
  'This account was signed in on another device. Sign in again here if you want to continue on this device.';
const PARTNER_APPLICATION_REJECTED_FALLBACK =
  'Your restaurant account is not active yet. Update your details with the operations team before trying again.';
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

const isTransientNetworkError = (error: unknown) => isProfileOfflineError(error) || isNetworkRequestError(error);

const getPartnerAuthErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (isTransientNetworkError(error)) {
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

type PartnerAccessState =
  | {
      kind: 'restaurant';
      userRole: 'restaurant';
    }
  | {
      kind: 'complete-profile';
      userRole: 'customer';
    }
  | {
      kind: 'blocked';
      message: string;
    };

const resolvePartnerAccessState = (
  claimRole: 'customer' | 'restaurant' | null,
  userDocument: UserDocument | null
): PartnerAccessState => {
  if (!userDocument) {
    return {
      kind: 'blocked',
      message: MISSING_PROFILE_ERROR,
    };
  }

  if (userDocument.partnerApplicationStatus === 'pending') {
    return {
      kind: 'blocked',
      message: 'Your restaurant account is being prepared. Sign in again shortly.',
    };
  }

  if (userDocument.partnerApplicationStatus === 'rejected') {
    return {
      kind: 'blocked',
      message: userDocument.partnerApplicationRejectionReason ?? PARTNER_APPLICATION_REJECTED_FALLBACK,
    };
  }

  if (claimRole === 'restaurant') {
    return {
      kind: 'restaurant',
      userRole: 'restaurant',
    };
  }

  return {
    kind: 'complete-profile',
    userRole: 'customer',
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether a partner is already signed in, without re-subscribing the
  // auth listener. Used to avoid re-showing the full-screen spinner when the
  // browser re-fires SIGNED_IN on tab/app refocus.
  const hasUserRef = useRef(false);

  useEffect(() => {
    hasUserRef.current = Boolean(user);
  }, [user]);

  const clearLocalUserState = useCallback(async () => {
    await Promise.all([clearStoredSessionId(), clearStoredUserProfile()]);
  }, []);

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
      let userDocument = await getUserDocument(authUser.id);

      if (!userDocument) {
        userDocument = await createUserDocument(authUser.id, {
          displayName:
            (authUser.user_metadata?.display_name as string | undefined) ??
            (authUser.user_metadata?.full_name as string | undefined) ??
            undefined,
          email: authUser.email ?? '',
          emailVerified: Boolean(authUser.email_confirmed_at),
          phoneNumber: (authUser.user_metadata?.phone as string | undefined) ?? undefined,
          role: 'customer',
        });
      }

      const accessState = resolvePartnerAccessState(claimRole === 'restaurant' ? 'restaurant' : 'customer', userDocument);

      if (accessState.kind === 'blocked') {
        await clearLocalUserState();
        await signOutUser(supabase);
        setUser(null);
        setError(accessState.message);
        return null;
      }

      return {
        ...userDocument,
        uid: authUser.id,
        email: authUser.email ?? userDocument.email,
        emailVerified: Boolean(authUser.email_confirmed_at),
        role: accessState.userRole,
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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (!session) {
        setLoading(false);
        return;
      }

      const cachedUser = await getStoredUserProfile<UserDocument>();

      if (!active) {
        return;
      }

      if (
        shouldHydrateCachedUserProfile({
          sessionUserId: session.user.id,
          cachedUser,
          expectedRole: 'restaurant',
        })
      ) {
        setUser(cachedUser);
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
      // re-block the UI once the first paint has resolved. Only a *fresh*
      // sign-in returns to the full-screen spinner — on web, refocusing the tab
      // re-fires SIGNED_IN for an already-signed-in partner, and that must
      // reconcile silently in the background instead of flashing the spinner.
      if (event === 'SIGNED_IN' && !hasUserRef.current) {
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

  const signUp = async (
    email: string,
    password: string,
    userData: {
      contactName: string;
      phoneNumber: string;
    }
  ) => {
    setLoading(true);
    setError(null);

    try {
      const { user: authUser, session } = await createUserWithEmail(supabase, email, password, {
        display_name: userData.contactName.trim(),
        phone: userData.phoneNumber.trim(),
        role: 'customer',
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
        console.warn('Partner login created, but verification email could not be sent:', verificationError);
      }

      return { verificationEmailSent, sessionPresent: Boolean(session) };
    } catch (nextError: any) {
      const resolvedMessage = getPartnerAuthErrorMessage(nextError, 'Unable to sign up');

      setError(resolvedMessage);
      throw new Error(resolvedMessage);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const authUser = await signInWithEmail(supabase, email, password);
      const nextUser = await buildNextUser(authUser);

      if (!nextUser) {
        const message = error ?? MISSING_PROFILE_ERROR;
        throw new Error(message);
      }

      await startSingleDeviceSession(authUser.id);

      setUser(nextUser);
      await storeUserProfile(nextUser);
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
