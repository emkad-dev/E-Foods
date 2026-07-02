/// <reference path="./edge-runtime.d.ts" />

import { createClient } from 'npm:@supabase/supabase-js@2';

const resolveSupabaseUrl = () => Deno.env.get('SUPABASE_URL')?.trim() ?? '';
const resolveSupabaseAnonKey = () => Deno.env.get('SUPABASE_ANON_KEY')?.trim() ?? '';
const resolveServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';

const assertSupabaseEnv = () => {
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required for Supabase Edge Functions.');
  }

  if (!supabaseAnonKey) {
    throw new Error('SUPABASE_ANON_KEY is required for Supabase Edge Functions.');
  }

  return { supabaseAnonKey, supabaseUrl };
};

const createLazyClient = <T>(factory: () => T): T =>
  new Proxy({} as T, {
    get(_target, property, receiver) {
      const client = factory() as Record<PropertyKey, unknown>;
      const value = Reflect.get(client, property, receiver);
      return typeof value === 'function' ? value.bind(client) : value;
    },
    set(_target, property, value, receiver) {
      const client = factory() as Record<PropertyKey, unknown>;
      return Reflect.set(client, property, value, receiver);
    },
  });

let authClientInstance: ReturnType<typeof createClient> | null = null;
let serviceClientInstance: ReturnType<typeof createClient> | null = null;

const getAuthClient = () =>
  authClientInstance ??
  (authClientInstance = (() => {
    const { supabaseAnonKey, supabaseUrl } = assertSupabaseEnv();
    return createClient(supabaseUrl, supabaseAnonKey);
  })());

const getServiceClient = () =>
  serviceClientInstance ??
  (serviceClientInstance = (() => {
    const supabaseUrl = resolveSupabaseUrl();
    const serviceRoleKey = resolveServiceRoleKey();

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL is required for Supabase Edge Functions.');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for privileged Supabase Edge Functions.');
    }

    return createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  })());

export const authClient = createLazyClient(getAuthClient);
export const serviceClient = createLazyClient(getServiceClient);
