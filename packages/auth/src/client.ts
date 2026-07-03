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

const createSessionStorage = () => {
  const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

  if (!isBrowser) {
    // Native (iOS/Android): persist the Supabase session in AsyncStorage so the
    // access token survives reloads and is attached to authenticated requests.
    return AsyncStorage;
  }

  return {
    getItem: async (key: string) => window.localStorage.getItem(key),
    setItem: async (key: string, value: string) => {
      window.localStorage.setItem(key, value);
    },
    removeItem: async (key: string) => {
      window.localStorage.removeItem(key);
    },
  };
};

export const createEbuySupabaseClient = (env: SupabaseRuntimeEnv) => {
  const url = resolveSupabaseEnvValue(env.url, 'EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = resolveSupabaseEnvValue(env.anonKey, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storage: createSessionStorage() as never,
    },
  });
};

export const getSharedSupabaseClient = (env: SupabaseRuntimeEnv) => {
  if (!sharedClient) {
    sharedClient = createEbuySupabaseClient(env);
  }

  return sharedClient;
};
