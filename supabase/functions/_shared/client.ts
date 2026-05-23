/// <reference path="./edge-runtime.d.ts" />

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL is required for Supabase Edge Functions.');
}

if (!supabaseAnonKey) {
  throw new Error('SUPABASE_ANON_KEY is required for Supabase Edge Functions.');
}

if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for privileged Supabase Edge Functions.');
}

export const authClient = createClient(supabaseUrl, supabaseAnonKey);
export const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
