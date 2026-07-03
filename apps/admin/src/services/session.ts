import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_STORAGE_KEY = '@ebuy/admin-active-session-id';
const USER_STORAGE_KEY = '@ebuy/admin-user-cache';
const ADMIN_READ_CACHE_PREFIX = '@ebuy/admin-read-cache:';
const SIDEBAR_PREFS_KEY = '@ebuy/admin-sidebar-prefs';

export type AdminSidebarSide = 'left' | 'right';

export type AdminSidebarPrefs = {
  side: AdminSidebarSide;
  width: number;
};

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 380;
export const DEFAULT_SIDEBAR_PREFS: AdminSidebarPrefs = { side: 'left', width: 240 };

const clampSidebarWidth = (width: number): number => {
  if (!Number.isFinite(width)) {
    return DEFAULT_SIDEBAR_PREFS.width;
  }

  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
};

export const getStoredSidebarPrefs = async (): Promise<AdminSidebarPrefs> => {
  const serialized = await AsyncStorage.getItem(SIDEBAR_PREFS_KEY);

  if (!serialized) {
    return { ...DEFAULT_SIDEBAR_PREFS };
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<AdminSidebarPrefs>;
    const side: AdminSidebarSide = parsed.side === 'right' ? 'right' : 'left';
    const width = clampSidebarWidth(Number(parsed.width ?? DEFAULT_SIDEBAR_PREFS.width));

    return { side, width };
  } catch {
    await AsyncStorage.removeItem(SIDEBAR_PREFS_KEY);
    return { ...DEFAULT_SIDEBAR_PREFS };
  }
};

export const storeSidebarPrefs = (prefs: AdminSidebarPrefs) =>
  AsyncStorage.setItem(
    SIDEBAR_PREFS_KEY,
    JSON.stringify({ side: prefs.side, width: clampSidebarWidth(prefs.width) })
  );

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

export const getStoredAdminReadCache = async <T>(cacheKey: string): Promise<T | null> => {
  const serializedSnapshot = await AsyncStorage.getItem(`${ADMIN_READ_CACHE_PREFIX}${cacheKey}`);

  if (!serializedSnapshot) {
    return null;
  }

  try {
    return JSON.parse(serializedSnapshot) as T;
  } catch {
    await AsyncStorage.removeItem(`${ADMIN_READ_CACHE_PREFIX}${cacheKey}`);
    return null;
  }
};

export const storeStoredAdminReadCache = (cacheKey: string, snapshot: unknown) =>
  AsyncStorage.setItem(`${ADMIN_READ_CACHE_PREFIX}${cacheKey}`, JSON.stringify(snapshot));
