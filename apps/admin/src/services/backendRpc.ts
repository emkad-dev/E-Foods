import { callBackendRpc } from '../../../../packages/auth/src';
import { appEnv, supabaseEnv } from '../config/env';
import { supabase } from './supabase/config';

export const callAdminBackendRpc = <T>(action: string, data?: Record<string, unknown>) =>
  callBackendRpc<T>(supabase, {
    backendRpcUrl: appEnv.backendRpcUrl,
    supabaseAnonKey: supabaseEnv.anonKey,
    projectId: appEnv.projectId,
    region: appEnv.functionsRegion,
    supabaseUrl: supabaseEnv.url,
  }, action, data);
