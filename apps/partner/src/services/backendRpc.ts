import { callBackendRpc } from '../../../../packages/auth/src';
import { appEnv, supabaseEnv } from '../config/env';
import { supabase } from './supabase/config';

export const callPartnerBackendRpc = <T>(action: string, data?: Record<string, unknown>) =>
  callBackendRpc<T>(supabase, {
    backendRpcUrl: appEnv.backendRpcUrl,
    projectId: appEnv.projectId,
    region: appEnv.functionsRegion,
    supabaseUrl: supabaseEnv.url,
  }, action, data);
