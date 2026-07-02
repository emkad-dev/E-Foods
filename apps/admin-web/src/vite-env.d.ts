/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_BACKEND_RPC_URL?: string;
  readonly EXPO_PUBLIC_SUPABASE_URL?: string;
  readonly EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly EXPO_PUBLIC_BACKEND_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
