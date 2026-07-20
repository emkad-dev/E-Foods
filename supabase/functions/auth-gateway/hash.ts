/// <reference path="../_shared/edge-runtime.d.ts" />

const salt = () => {
  const s = Deno.env.get('AUTH_HASH_SALT') ?? '';
  // Fail loudly on a mis-provisioned deploy: an empty/short salt would make the
  // audit HMAC deterministic and dictionary-attackable if the table ever leaks.
  if (s.length < 16) {
    throw new Error('AUTH_HASH_SALT must be set to at least 16 characters.');
  }
  return s;
};

export const hashValue = async (value: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const SENSITIVE_KEYS = new Set(['password', 'access_token', 'refresh_token', 'authorization']);

export const redact = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
};
