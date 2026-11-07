import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_STORAGE_KEY = '@ebuy/customer-active-session-id';
const USER_STORAGE_KEY = '@ebuy/customer-user-cache';
const POLICY_ACCEPTED_STORAGE_KEY = '@ebuy/customer-policy-accepted';
const PENDING_POLICY_ACCEPTANCE_STORAGE_KEY = '@ebuy/customer-pending-policy-acceptance';

export const createSessionId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;

export const getStoredSessionId = () => AsyncStorage.getItem(SESSION_STORAGE_KEY);

export const storeSessionId = (sessionId: string) => AsyncStorage.setItem(SESSION_STORAGE_KEY, sessionId);

export const clearStoredSessionId = () => AsyncStorage.removeItem(SESSION_STORAGE_KEY);

export const getStoredUserProfile = async <T>() => {
  const serializedUserProfile = await AsyncStorage.getItem(USER_STORAGE_KEY);

  if (!serializedUserProfile) {
    return null;
  }

  try {
    return JSON.parse(serializedUserProfile) as T;
  } catch {
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
    return null;
  }
};

export const storeUserProfile = (userProfile: unknown) =>
  AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfile));

export const clearStoredUserProfile = () => AsyncStorage.removeItem(USER_STORAGE_KEY);

// Cached policy-acceptance flag lets the first paint skip the blocking policy
// gate for returning users while the real status reconciles in the background.
export const getStoredPolicyAccepted = async () => {
  const value = await AsyncStorage.getItem(POLICY_ACCEPTED_STORAGE_KEY);

  return value === 'true';
};

export const storePolicyAccepted = (accepted: boolean) =>
  AsyncStorage.setItem(POLICY_ACCEPTED_STORAGE_KEY, accepted ? 'true' : 'false');

export const clearStoredPolicyAccepted = () => AsyncStorage.removeItem(POLICY_ACCEPTED_STORAGE_KEY);

// Separate from the display cache above, which holds no owner and also follows
// server reads: a sign-up's acceptance waits here, under the id of the account that
// gave it, until that account has a session to record it with. It survives sign-out
// because only its owner can ever use it.
export const getPendingPolicyAcceptanceUserId = () => AsyncStorage.getItem(PENDING_POLICY_ACCEPTANCE_STORAGE_KEY);

export const storePendingPolicyAcceptance = (userId: string) =>
  AsyncStorage.setItem(PENDING_POLICY_ACCEPTANCE_STORAGE_KEY, userId);

export const clearPendingPolicyAcceptance = () => AsyncStorage.removeItem(PENDING_POLICY_ACCEPTANCE_STORAGE_KEY);
