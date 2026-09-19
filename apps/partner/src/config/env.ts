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

export const supabaseEnv = {
  url: getEnvValue(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL
  ),
  anonKey: getEnvValue(
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ),
  projectRef: getEnvValue(
    process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_PROJECT_REF
  ),
};

export const appEnv = {
  appScheme:
    getEnvValue(
      process.env.EXPO_PUBLIC_APP_SCHEME,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_APP_SCHEME
    ) ?? 'feasty-partner',
  partnerWebOrigin:
    getEnvValue(
      process.env.EXPO_PUBLIC_PARTNER_WEB_ORIGIN,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_PARTNER_WEB_ORIGIN
    ) ?? 'https://partner.feasty.com.ng',
  projectId: getEnvValue(
    process.env.EXPO_PUBLIC_PROJECT_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_PROJECT_ID
  ),
  // NATIVE-ONLY credential for Google sign-in, and deliberately left unset in
  // app.json. On web the browser never sees a Google client ID — the redirect
  // goes to Supabase, which holds the client ID/secret — so leaving this blank
  // costs the web build nothing. On native it is the `webClientId` the Google
  // SDK signs its ID token for, and setting it here would turn the native
  // button ON before the Android/iOS OAuth clients for `com.feasty.partner`
  // exist in Google Cloud, which fails with a bare DEVELOPER_ERROR. See
  // src/services/googleSignIn.ts.
  googleWebClientId: getEnvValue(
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  ),
  backendRpcUrl: getEnvValue(
    process.env.EXPO_PUBLIC_BACKEND_RPC_URL,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_RPC_URL
  ),
  // Kill switch for RPC routing: 'split' (default) sends each action to its
  // own domain function; 'legacy' routes everything to app-rpc. Passed
  // through raw — resolveRpcMode normalizes unset/blank/unrecognized values
  // to 'split'.
  rpcMode: getEnvValue(
    process.env.EXPO_PUBLIC_RPC_MODE,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_RPC_MODE
  ),
  functionsRegion:
    getEnvValue(
      process.env.EXPO_PUBLIC_FUNCTIONS_REGION,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_FUNCTIONS_REGION
    ) ?? 'us-central1',
};
