import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { boundedFetch } from './boundedFetch';
import { boundedNavigatorLock } from './sessionLock';
import type { SupabaseRuntimeEnv } from './types';

let sharedClient: SupabaseClient | null = null;

const resolveSupabaseEnvValue = (value: string | undefined, label: string) => {
  if (!value?.trim()) {
    throw new Error(`Missing Supabase configuration value: ${label}`);
  }

  return value.trim();
};

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const createSessionStorage = () => {
  if (!isBrowser()) {
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
      // Native has no navigator.locks at all (GoTrueClient already falls
      // back to its own in-process lock there on its own); only the web
      // client needs the bounded wrapper. See sessionLock.ts for why the
      // library's own default lock can hang forever with zero visible error.
      ...(isBrowser() ? { lock: boundedNavigatorLock } : null),
    },
    // GoTrueClient's own fetch comes from here, NOT auth.fetch -- see
    // boundedFetch.ts for why an unbounded fetch is the actual root cause
    // the lock wrapper alone can't fully protect against. Applies on native
    // too (RN has AbortController + fetch), not just web.
    global: {
      fetch: boundedFetch,
    },
  });
};

export const getSharedSupabaseClient = (env: SupabaseRuntimeEnv) => {
  if (!sharedClient) {
    sharedClient = createEbuySupabaseClient(env);
  }

  return sharedClient;
};
