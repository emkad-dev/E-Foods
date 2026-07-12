import { serviceClient } from '../_shared/client.ts';
import { ClientSafeError, logEdgeEvent } from '../_shared/observability.ts';
import { hashValue } from './hash.ts';

export type RlPolicy = { limit: number; windowSecs: number; lockoutSecs: number };

// NOTE: when lockoutSecs < windowSecs, a caller that is already over the limit
// can be re-locked on its first post-lockout hit (the window has not reset yet),
// effectively extending the lockout under continued traffic. That is acceptable
// (and arguably desirable) for abuse mitigation on signup/refresh.
export const POLICIES = {
  ipGeneral:    { limit: 30, windowSecs: 600, lockoutSecs: 600 } as RlPolicy,  // per-IP ceiling
  loginFailure: { limit: 5,  windowSecs: 600, lockoutSecs: 900 } as RlPolicy,  // 5 fails/10m -> 15m lock
  signupPerIp:  { limit: 10, windowSecs: 3600, lockoutSecs: 900 } as RlPolicy,
  refreshPerIp: { limit: 60, windowSecs: 600, lockoutSecs: 300 } as RlPolicy,
};

export const enforceRateLimit = async (rawKey: string, policy: RlPolicy): Promise<void> => {
  const key = await hashValue(rawKey);
  const { data, error } = await serviceClient.rpc('auth_rl_hit', {
    p_key: key,
    p_limit: policy.limit,
    p_window_secs: policy.windowSecs,
    p_lockout_secs: policy.lockoutSecs,
  });
  if (error) {
    // Fail open on infra error, but log it — do not block legitimate users if the RPC is down.
    logEdgeEvent('error', 'rate limit RPC failed', { reason: error.message });
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) {
    throw new ClientSafeError(429, 'Too many attempts. Please try again later.');
  }
};
