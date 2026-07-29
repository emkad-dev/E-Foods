import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appEnv } from '../config/env';

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
const isExpoGo = Constants.executionEnvironment === 'storeClient';

const loadGoogleSigninModule = (): GoogleSigninModule | null => {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  if (isExpoGo) {
    cachedModule = null;
    return cachedModule;
  }

  try {
    // This native module is only available in Android/iOS builds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('@react-native-google-signin/google-signin')
      .GoogleSignin as GoogleSigninModule;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
};

const getConfiguredWebClientId = (): string | null => {
  const rawValue = appEnv.googleWebClientId;

  if (typeof rawValue !== 'string') {
    return null;
  }

  const webClientId = rawValue.trim();

  if (!webClientId || webClientId === PLACEHOLDER_WEB_CLIENT_ID) {
    return null;
  }

  return webClientId;
};

export const hasGoogleSignInConfig = () => Boolean(getConfiguredWebClientId());

export const getGoogleSignInUnavailableMessage = (): string | null => {
  if (!getConfiguredWebClientId()) {
    return 'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and enable Google in Supabase Auth before using customer Google sign-in.';
  }

  if (Platform.OS !== 'web' && isExpoGo) {
    return 'Google Sign-In is not available in Expo Go. Use a development build or rebuild the native app with "npx expo run:android" or "npx expo run:ios".';
  }

  if (Platform.OS !== 'web' && !loadGoogleSigninModule()) {
    return 'Google Sign-In is not available in this app build. If you are using Expo Go, switch to a development build. If you already added the package, rebuild the native app with "npx expo run:android" or "npx expo run:ios".';
  }

  return null;
};

export const configureGoogleSignIn = (): { ok: true } | { ok: false; message: string } => {
  const unavailableMessage = getGoogleSignInUnavailableMessage();

  if (unavailableMessage) {
    return { ok: false, message: unavailableMessage };
  }

  if (Platform.OS === 'web') {
    return { ok: true };
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

export const signInWithGoogleOAuth = async (supabase: SupabaseClient) => {
  const webClientId = getConfiguredWebClientId();

  if (!webClientId) {
    throw new Error('Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and enable Google in Supabase Auth before using customer Google sign-in.');
  }

  const redirectTo = Linking.createURL('/verify-email');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    throw error;
  }

  const authUrl = data?.url;
  if (authUrl && typeof window !== 'undefined') {
    window.location.assign(authUrl);
  }
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
