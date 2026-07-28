import { createClient } from '@supabase/supabase-js';
import { appEnv } from '../config/env';

export const supabase = createClient(appEnv.supabaseUrl, appEnv.supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
  },
});
