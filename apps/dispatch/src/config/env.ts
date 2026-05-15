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
  projectId: getEnvValue(
    process.env.EXPO_PUBLIC_PROJECT_ID,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_PROJECT_ID
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
};

const getBooleanEnvValue = (inlineValue: string | undefined, extraValue: unknown) => {
  const resolvedValue = getEnvValue(inlineValue, extraValue)?.toLowerCase();
  return resolvedValue === '1' || resolvedValue === 'true' || resolvedValue === 'yes';
};

export const devAuthEnv = {
  enabled: getBooleanEnvValue(
    process.env.EXPO_PUBLIC_DEV_AUTH_BYPASS,
    Constants.expoConfig?.extra?.EXPO_PUBLIC_DEV_AUTH_BYPASS
  ),
  email:
    getEnvValue(
      process.env.EXPO_PUBLIC_DEV_AUTH_EMAIL,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_DEV_AUTH_EMAIL
    ) ?? 'dispatch.dev@ebuy.local',
  uid:
    getEnvValue(
      process.env.EXPO_PUBLIC_DEV_AUTH_UID,
      Constants.expoConfig?.extra?.EXPO_PUBLIC_DEV_AUTH_UID
    ) ?? 'dispatch-dev-user',
};
