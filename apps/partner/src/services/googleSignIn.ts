import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { SupabaseClient, User as SupabaseAuthUser } from '@supabase/supabase-js';
import { appEnv } from '../config/env';

/**
 * Google sign-in for the partner console, ported from `apps/customer`.
 *
 * WHY THIS EXISTS AT ALL: restaurants invite staff by email, and a Google
 * account has no password — `auth.users.encrypted_password` is null for
 * `provider: google`. Until this file existed, an invited staff member who
 * happened to be a Google user could not reach the partner app by ANY route:
 * they cannot sign in (no password), and they cannot "reset" one either,
 * because there is nothing to reset. This is the only door for them.
 *
 * Two flows, exactly as in the customer app:
 *   - web      → full-page OAuth redirect through Supabase (`/auth/v1/authorize`)
 *   - native   → the Google SDK returns an ID token, exchanged for a Supabase
 *                session via `signInWithIdToken`
 *
 * Partner's real deployment is the web build at partner.feasty.com.ng, so the
 * web leg is the one that unblocks the person this was written for. The native
 * leg is ported in full but stays dark until an operator configures it; see
 * `getNativeGoogleSignInUnavailableMessage`.
 */

const PLACEHOLDER_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

/**
 * Marks a redirect as ours.
 *
 * Only consulted for the `?code=` (PKCE) branch below. The implicit-flow hash
 * is self-identifying — nothing but an OAuth return puts `#access_token=` on a
 * partner URL — but a bare `?code=` is not: this app already speaks in
 * six-digit codes (email OTP, staff invites), and silently feeding one of
 * those to `exchangeCodeForSession` would be a confusing failure at best.
 */
const OAUTH_MARKER_PARAM = 'feasty_oauth';
const OAUTH_MARKER_VALUE = 'google';

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
let configuredWithClientId: string | null = null;

const isExpoGo = Constants.executionEnvironment === 'storeClient';

/**
 * `@react-native-google-signin/google-signin` is a NATIVE module and is not a
 * declared dependency of this app (it is one of the customer app's). The
 * require is therefore wrapped and cached: on web, in Expo Go, and in any
 * partner build that has not added the package, this resolves to `null` and
 * the native button simply never appears — rather than the app crashing at
 * import time, which a top-level `import` would do.
 */
const loadGoogleSigninModule = (): GoogleSigninModule | null => {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  if (Platform.OS === 'web' || isExpoGo) {
    cachedModule = null;
    return cachedModule;
  }

  try {
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

/**
 * Why the native path needs a client ID and the web path does not.
 *
 * On web the browser never sees a Google client ID: it is handed to
 * `supabase.auth.signInWithOAuth`, which bounces to Supabase's own
 * `/auth/v1/authorize?provider=google`, and SUPABASE holds the client
 * ID/secret in its dashboard. The value below is a native-only credential —
 * the `webClientId` the Google SDK signs its ID token for.
 *
 * Returns null when the native flow is ready to use.
 */
export const getNativeGoogleSignInUnavailableMessage = (): string | null => {
  if (Platform.OS === 'web') {
    return null;
  }

  if (!getConfiguredWebClientId()) {
    return 'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and enable Google in Supabase Auth before using partner Google sign-in.';
  }

  if (isExpoGo) {
    return 'Google Sign-In is not available in Expo Go. Use a development build, or rebuild the native app with "npx expo run:android" / "npx expo run:ios".';
  }

  if (!loadGoogleSigninModule()) {
    return 'Google Sign-In is not available in this app build. Add @react-native-google-signin/google-signin to apps/partner and rebuild the native app.';
  }

  return null;
};

/**
 * Whether to draw the button at all.
 *
 * DELIBERATE DIVERGENCE FROM CUSTOMER: the customer app always renders its
 * Google button and reports "unavailable" on press. Partner hides it instead
 * when it cannot work, because a dead control on the ONE screen an invited
 * staff member reaches is worse than no control — they would tap it, get a
 * message about Expo Go or an environment variable, and have no idea that the
 * email/password fields above are simply not for them.
 *
 * Web is always `true`: whether Google is enabled lives in the Supabase
 * dashboard, which the client cannot inspect. If it is off, Supabase answers
 * the press with an error and the button surfaces it — which is far more
 * diagnosable than a button that was never drawn.
 */
export const canUseGoogleSignIn = (): boolean =>
  Platform.OS === 'web' || getNativeGoogleSignInUnavailableMessage() === null;

const configureNativeGoogleSignIn = (): void => {
  const googleSignin = loadGoogleSigninModule();
  const webClientId = getConfiguredWebClientId();

  if (!googleSignin || !webClientId) {
    return;
  }

  // Configured lazily on first use rather than from the root layout (where the
  // customer app does it). Nothing before the first press needs it, and
  // keeping it here means the root layout has no knowledge of Google at all.
  if (configuredWithClientId === webClientId) {
    return;
  }

  googleSignin.configure({
    webClientId,
    scopes: ['profile', 'email'],
  });

  configuredWithClientId = webClientId;
};

const stripAuthParamsFromUrl = (): void => {
  if (typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }

  // Back to the bare path: drops the token hash, the `?code=`, and our own
  // marker in one go, so a reload cannot replay a one-shot credential.
  window.history.replaceState(null, '', window.location.pathname);
};

/**
 * Starts the web OAuth redirect. Never returns on success — the tab navigates
 * away to Google and comes back to `completeGoogleWebRedirect`.
 */
export const startGoogleWebSignIn = async (supabase: SupabaseClient): Promise<void> => {
  if (typeof window === 'undefined') {
    throw new Error('Google sign-in redirect is only available in a browser.');
  }

  // Return to the exact page we left, not a hard-coded route. The partner web
  // build is a STATIC export, so a route only exists as a served file if the
  // host maps it; the page we are standing on demonstrably does. Query and
  // hash are dropped so the marker below is the only thing on the URL.
  const redirectTo = `${window.location.origin}${window.location.pathname}?${OAUTH_MARKER_PARAM}=${OAUTH_MARKER_VALUE}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      // We navigate ourselves (below) instead of letting supabase-js do it, so
      // that a missing URL is an error we can report rather than a press that
      // appears to do nothing.
      skipBrowserRedirect: true,
      queryParams: {
        // `select_account`, not the customer app's `consent`. An invited staff
        // member is very likely signed into a personal Google account in this
        // browser while the invitation went to a work address; forcing the
        // account chooser is the difference between joining the right
        // restaurant and creating a stray second profile. We ask for no
        // offline access because Supabase mints and refreshes its own session.
        prompt: 'select_account',
      },
    },
  });

  if (error) {
    throw error;
  }

  const authUrl = data?.url;

  if (!authUrl) {
    throw new Error('Google sign-in could not be started. Try again in a moment.');
  }

  window.location.assign(authUrl);
};

/**
 * Consumes an OAuth return, if this page load is one. Returns the signed-in
 * Supabase user, or null when there is nothing to consume.
 *
 * WHY THIS IS HAND-ROLLED: the shared Supabase client
 * (`packages/auth/src/client.ts`) is created with `detectSessionInUrl: false`,
 * so supabase-js will NOT pick the session out of the returning URL by itself.
 * Nothing in the repo calls `setSession` or `exchangeCodeForSession` either.
 * Without the code below, the browser would come back from Google carrying a
 * perfectly good token and the app would sit on the login screen.
 *
 * Both flows are handled because the flow is not pinned anywhere: auth-js
 * defaults to `implicit` (tokens in the fragment), and a later `flowType:
 * 'pkce'` on the shared client would silently switch this to `?code=`.
 */
export const completeGoogleWebRedirect = async (
  supabase: SupabaseClient
): Promise<SupabaseAuthUser | null> => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  const isOurRedirect = queryParams.get(OAUTH_MARKER_PARAM) === OAUTH_MARKER_VALUE;

  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const authCode = isOurRedirect ? queryParams.get('code') : null;
  const failure =
    hashParams.get('error_description') ??
    hashParams.get('error') ??
    (isOurRedirect ? queryParams.get('error_description') ?? queryParams.get('error') : null);

  if (!accessToken && !authCode && !failure) {
    return null;
  }

  // Cleared before anything can throw, so a failed attempt leaves a clean URL
  // to retry from instead of re-reporting itself on every reload.
  stripAuthParamsFromUrl();

  if (failure) {
    throw new Error(failure);
  }

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      throw error;
    }

    return data.user ?? null;
  }

  if (authCode) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);

    if (error) {
      throw error;
    }

    return data.user ?? null;
  }

  // An access token with no refresh token: the session would die at the first
  // token refresh, so treat it as a failure rather than signing someone in to
  // an account that logs itself out an hour later.
  throw new Error('Google returned an incomplete session. Try signing in again.');
};

/**
 * Native only: drives the Google SDK and returns the ID token that
 * `signInWithIdToken` exchanges for a Supabase session.
 */
export const signInWithGoogleIdToken = async (): Promise<string> => {
  const unavailableMessage = getNativeGoogleSignInUnavailableMessage();

  if (unavailableMessage) {
    throw new Error(unavailableMessage);
  }

  configureNativeGoogleSignIn();

  const googleSignin = loadGoogleSigninModule();

  if (!googleSignin) {
    throw new Error('Google Sign-In native module is unavailable.');
  }

  await googleSignin.hasPlayServices();

  const userInfo = await googleSignin.signIn();
  // The SDK moved this under `data` in v13+; both shapes are read so the same
  // code works whichever major version a build resolves.
  const idToken = userInfo.data?.idToken ?? userInfo.idToken;

  if (!idToken) {
    throw new Error('Google did not return an ID token. Try again.');
  }

  return idToken;
};
