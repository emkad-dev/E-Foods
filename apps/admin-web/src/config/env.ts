const readEnv = (value: string | undefined, label: string) => {
  if (!value?.trim()) {
    throw new Error(
      `Missing environment value: ${label}. Add it to apps/admin-web/.env.local or expose it through the deployment environment.`
    );
  }

  return value.trim();
};

const resolveEnv = (...values: Array<string | undefined>) => values.find((value) => value?.trim())?.trim();

export const appEnv = {
  supabaseUrl: readEnv(
    resolveEnv(import.meta.env.VITE_SUPABASE_URL, import.meta.env.EXPO_PUBLIC_SUPABASE_URL),
    'VITE_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL'
  ),
  supabaseAnonKey: readEnv(
    resolveEnv(import.meta.env.VITE_SUPABASE_ANON_KEY, import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    'VITE_SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY'
  ),
  backendRpcUrl: resolveEnv(import.meta.env.VITE_BACKEND_RPC_URL, import.meta.env.EXPO_PUBLIC_BACKEND_RPC_URL),
};
