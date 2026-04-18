import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_STORAGE_KEY = '@ebuy/partner-active-session-id';

export const createSessionId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;

export const getStoredSessionId = () => AsyncStorage.getItem(SESSION_STORAGE_KEY);

export const storeSessionId = (sessionId: string) => AsyncStorage.setItem(SESSION_STORAGE_KEY, sessionId);

export const clearStoredSessionId = () => AsyncStorage.removeItem(SESSION_STORAGE_KEY);
