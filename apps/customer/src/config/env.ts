import Constants from 'expo-constants';

const getEnvValue = (
  inlineValue: string | undefined,
  extraValue: unknown
): string | undefined => {
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
  appDomain:
    getEnvValue(
      process.env.EXPO_PUBLIC_APP_DOMAIN,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_APP_DOMAIN
    ) ?? 'app.feasty.com.ng',
  appScheme:
    getEnvValue(
      process.env.EXPO_PUBLIC_APP_SCHEME,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_APP_SCHEME
    ) ?? 'feasty-customer',
  projectId: getEnvValue(
    process.env.EXPO_PUBLIC_PROJECT_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_PROJECT_ID
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
  catalogUrl: getEnvValue(
    process.env.EXPO_PUBLIC_CATALOG_URL,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_CATALOG_URL
  ),
  functionsRegion:
    getEnvValue(
      process.env.EXPO_PUBLIC_FUNCTIONS_REGION,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_FUNCTIONS_REGION
    ) ?? 'us-central1',
};
