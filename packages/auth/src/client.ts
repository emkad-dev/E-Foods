import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseRuntimeEnv } from './types';

let sharedClient: SupabaseClient | null = null;

const resolveSupabaseEnvValue = (value: string | undefined, label: string) => {
  if (!value?.trim()) {
    throw new Error(`Missing Supabase configuration value: ${label}`);
  }

  return value.trim();
};

export const createFeastySupabaseClient = (env: SupabaseRuntimeEnv) => {
  const url = resolveSupabaseEnvValue(env.url, 'EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = resolveSupabaseEnvValue(env.anonKey, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storage: AsyncStorage as never,
    },
  });
};

export const getSharedSupabaseClient = (env: SupabaseRuntimeEnv) => {
  if (!sharedClient) {
    sharedClient = createFeastySupabaseClient(env);
  }

  return sharedClient;
};
