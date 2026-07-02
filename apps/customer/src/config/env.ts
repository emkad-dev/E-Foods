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
    ) ?? 'feasty.com',
  appScheme:
    getEnvValue(
      process.env.EXPO_PUBLIC_APP_SCHEME,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_APP_SCHEME
    ) ?? 'feasty-customer',
  verifyEmailPath:
    getEnvValue(
      process.env.EXPO_PUBLIC_VERIFY_EMAIL_PATH,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_VERIFY_EMAIL_PATH
    ) ?? 'verify-email',
  resetPasswordPath:
    getEnvValue(
      process.env.EXPO_PUBLIC_RESET_PASSWORD_PATH,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_RESET_PASSWORD_PATH
    ) ?? 'reset-password',
  projectId: getEnvValue(
    process.env.EXPO_PUBLIC_PROJECT_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_PROJECT_ID
  ),
  googleWebClientId: getEnvValue(
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  ),
  backendRpcUrl: getEnvValue(
    process.env.EXPO_PUBLIC_BACKEND_RPC_URL,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_RPC_URL
  ),
  functionsRegion:
    getEnvValue(
      process.env.EXPO_PUBLIC_FUNCTIONS_REGION,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_FUNCTIONS_REGION
    ) ?? 'us-central1',
  googleMapsApiKey: getEnvValue(
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
  ),
};
