import Constants from 'expo-constants';

const getEnvValue = (inlineValue: string | undefined, extraValue: unknown): string | undefined => {
  if (typeof inlineValue === 'string' && inlineValue.trim()) {
    return inlineValue.trim();
  }

  if (typeof extraValue === 'string' && extraValue.trim()) {
    return extraValue.trim();
  }

  return undefined;
};

export const firebaseEnv = {
  apiKey: getEnvValue(
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_API_KEY
  ),
  authDomain: getEnvValue(
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
  ),
  projectId: getEnvValue(
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_PROJECT_ID
  ),
  storageBucket: getEnvValue(
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
  ),
  messagingSenderId: getEnvValue(
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  ),
  appId: getEnvValue(
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_APP_ID
  ),
};
