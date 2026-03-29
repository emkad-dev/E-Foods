import Constants from 'expo-constants';
import { Platform } from 'react-native';

const PLACEHOLDER_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

type GoogleSignInResponse = {
  data?: {
    idToken?: string | null;
  } | null;
  idToken?: string | null;
};

type GoogleSigninModule = {
  configure: (options: { webClientId: string; scopes?: string[] }) => void;
  hasPlayServices: () => Promise<boolean>;
  signIn: () => Promise<GoogleSignInResponse>;
};

let cachedModule: GoogleSigninModule | null | undefined;

const loadGoogleSigninModule = (): GoogleSigninModule | null => {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  try {
    cachedModule = require('@react-native-google-signin/google-signin')
      .GoogleSignin as GoogleSigninModule;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
};

const getConfiguredWebClientId = (): string | null => {
  const rawValue = Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  if (typeof rawValue !== 'string') {
    return null;
  }

  const webClientId = rawValue.trim();

  if (!webClientId || webClientId === PLACEHOLDER_WEB_CLIENT_ID) {
    return null;
  }

  return webClientId;
};

export const getGoogleSignInUnavailableMessage = (): string | null => {
  if (Platform.OS === 'web') {
    return 'This Google Sign-In setup only supports native Android and iOS builds.';
  }

  if (!loadGoogleSigninModule()) {
    return 'Google Sign-In is not available in this app build. If you are using Expo Go, switch to a development build. If you already added the package, rebuild the native app with "npx expo run:android" or "npx expo run:ios".';
  }

  if (!getConfiguredWebClientId()) {
    return 'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in your .env file to your real Google Web Client ID before using Google Sign-In.';
  }

  return null;
};

export const configureGoogleSignIn = (): { ok: true } | { ok: false; message: string } => {
  const unavailableMessage = getGoogleSignInUnavailableMessage();

  if (unavailableMessage) {
    return { ok: false, message: unavailableMessage };
  }

  const googleSignin = loadGoogleSigninModule();
  const webClientId = getConfiguredWebClientId();

  if (!googleSignin || !webClientId) {
    return {
      ok: false,
      message: 'Google Sign-In could not be configured.',
    };
  }

  googleSignin.configure({
    webClientId,
    scopes: ['profile', 'email'],
  });

  return { ok: true };
};

export const signInWithGoogleIdToken = async (): Promise<string> => {
  const unavailableMessage = getGoogleSignInUnavailableMessage();

  if (unavailableMessage) {
    throw new Error(unavailableMessage);
  }

  const googleSignin = loadGoogleSigninModule();

  if (!googleSignin) {
    throw new Error('Google Sign-In native module is unavailable.');
  }

  await googleSignin.hasPlayServices();

  const userInfo = await googleSignin.signIn();
  const idToken = userInfo.data?.idToken ?? userInfo.idToken;

  if (!idToken) {
    throw new Error('Failed to get ID token from Google Sign-In. Please try again.');
  }

  return idToken;
};
