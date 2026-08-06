import { callBackendRpc } from '../../../../packages/auth/src/backendRpc';
import { appEnv } from '../config/env';
import { supabase } from './supabase';

export const callAdminRpc = <T>(action: string, data?: Record<string, unknown>) =>
  callBackendRpc<T>(
    supabase,
    {
      backendRpcUrl: appEnv.backendRpcUrl,
      anonKey: appEnv.supabaseAnonKey,
      rpcMode: appEnv.rpcMode,
      supabaseUrl: appEnv.supabaseUrl,
    },
    action,
    data
  );
