import type { SupabaseClient } from '@supabase/supabase-js';

export interface BackendRpcEnv {
  backendRpcUrl?: string;
  supabaseAnonKey?: string;
  projectId?: string;
  region?: string;
  supabaseUrl?: string;
}

const resolveRpcUrl = (env: BackendRpcEnv) => {
  if (env.backendRpcUrl?.trim()) {
    return env.backendRpcUrl.trim();
  }

  if (env.supabaseUrl?.trim()) {
    return `${env.supabaseUrl.trim().replace(/\/+$/, '')}/functions/v1/app-rpc`;
  }

  throw new Error(
    'Missing backend RPC configuration. Set EXPO_PUBLIC_BACKEND_RPC_URL or EXPO_PUBLIC_SUPABASE_URL for the native Supabase backend.'
  );
};

export const callBackendRpc = async <T>(
  supabase: SupabaseClient,
  env: BackendRpcEnv,
  action: string,
  data?: Record<string, unknown>
): Promise<T> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('You must be signed in before calling the protected backend.');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };

  if (env.supabaseAnonKey?.trim()) {
    headers.apikey = env.supabaseAnonKey.trim();
  }

  const response = await fetch(resolveRpcUrl(env), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action,
      data: data ?? {},
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        data?: T;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Backend RPC failed with status ${response.status}`);
  }

  return payload?.data as T;
};
