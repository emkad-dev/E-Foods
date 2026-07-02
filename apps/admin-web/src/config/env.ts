const readEnv = (value: string | undefined, label: string) => {
  if (!value?.trim()) {
    throw new Error(`Missing environment value: ${label}. Add it to apps/admin-web/.env.local`);
  }

  return value.trim();
};

export const appEnv = {
  supabaseUrl: readEnv(import.meta.env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL'),
  supabaseAnonKey: readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY, 'VITE_SUPABASE_ANON_KEY'),
  backendRpcUrl: import.meta.env.VITE_BACKEND_RPC_URL?.trim() || undefined,
};
