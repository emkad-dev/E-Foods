import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-device mute preference for the kitchen-display alarm (Task 15 / F1). Same
// AsyncStorage pattern as session.ts. Absence of a stored value means "never
// muted on this device" -- getStoredKitchenAlarmMuted() below resolves that to
// `false` so the alarm defaults to unmuted (sound on), matching the brief's
// "not a silent default" requirement.
const KITCHEN_ALARM_MUTED_STORAGE_KEY = '@feasty/partner-kitchen-alarm-muted';

export const getStoredKitchenAlarmMuted = async (): Promise<boolean> => {
  const storedValue = await AsyncStorage.getItem(KITCHEN_ALARM_MUTED_STORAGE_KEY);
  return storedValue === 'true';
};

export const storeKitchenAlarmMuted = (muted: boolean) =>
  AsyncStorage.setItem(KITCHEN_ALARM_MUTED_STORAGE_KEY, muted ? 'true' : 'false');
