import { callBackendRpc, type BackendRpcOptions } from '../../../../packages/auth/src';
import { appEnv, supabaseEnv } from '../config/env';
import { supabase } from './supabase/config';

export const callCustomerBackendRpc = <T>(action: string, data?: Record<string, unknown>, options?: BackendRpcOptions) =>
  callBackendRpc<T>(supabase, {
    anonKey: supabaseEnv.anonKey,
    backendRpcUrl: appEnv.backendRpcUrl,
    projectId: appEnv.projectId,
    region: appEnv.functionsRegion,
    rpcMode: appEnv.rpcMode,
    supabaseUrl: supabaseEnv.url,
  }, action, data, options);
