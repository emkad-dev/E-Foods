import { serviceClient } from './client.ts';
import { ClientSafeError, logEdgeEvent } from './observability.ts';

const TOO_MANY = 'Too many attempts. Please try again later.';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type DispatchRateLimitPolicy = { limit: number; windowSecs: number; lockoutSecs: number };

// Wraps the existing `auth_rl_hit` RPC. Keys are stored as `dispatch:<key>`
// unhashed on purpose: the table is service-role-only, a uid is not a secret,
// and this avoids depending on the auth-gateway AUTH_HASH_SALT being present
// in the dispatch function env. Fails OPEN on RPC error (abuse brake, not a
// credential gate).
export const enforceDispatchRateLimit = async (
  key: string,
  policy: DispatchRateLimitPolicy,
): Promise<void> => {
  const { data, error } = await serviceClient.rpc('auth_rl_hit', {
    p_key: `dispatch:${key}`,
    p_limit: policy.limit,
    p_window_secs: policy.windowSecs,
    p_lockout_secs: policy.lockoutSecs,
  });
  if (error) {
    logEdgeEvent('error', 'dispatch rate limit RPC failed', { reason: error.message });
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) throw new ClientSafeError(429, TOO_MANY);
};

// base64 length N decodes to roughly N*3/4 bytes.
const decodedBytes = (base64: string): number => Math.floor((base64.length * 3) / 4);

export const assertUploadAllowed = (input: {
  contentType?: string | null;
  base64: string;
  maxBytes: number;
}): void => {
  const type = (input.contentType ?? '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_IMAGE_TYPES.has(type)) throw new ClientSafeError(400, 'Upload must be a JPEG, PNG, or WebP image.');
  if (!input.base64 || decodedBytes(input.base64) > input.maxBytes) {
    throw new ClientSafeError(400, 'Image is too large. Please upload a photo under 5 MB.');
  }
};

// Generic form of the same `auth_rl_hit` brake for non-dispatch callers
// (partner submissions, admin alert email dedupe). Returns false when the key
// is over its limit; fails OPEN (true) when the RPC itself errors, for the
// same reason as above.
export const isRateLimitAllowed = async (
  key: string,
  policy: DispatchRateLimitPolicy,
): Promise<boolean> => {
  try {
    const { data, error } = await serviceClient.rpc('auth_rl_hit', {
      p_key: key,
      p_limit: policy.limit,
      p_window_secs: policy.windowSecs,
      p_lockout_secs: policy.lockoutSecs,
    });
    if (error) {
      logEdgeEvent('error', 'rate limit RPC failed', { reason: error.message });
      return true;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return !(row && row.allowed === false);
  } catch (error) {
    logEdgeEvent('error', 'rate limit RPC failed', { reason: error instanceof Error ? error.message : String(error) });
    return true;
  }
};
