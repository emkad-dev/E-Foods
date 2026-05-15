import { getSharedSupabaseClient } from '../../../../../packages/auth/src';
import { supabaseEnv } from '../../config/env';

export const supabase = getSharedSupabaseClient(supabaseEnv);
