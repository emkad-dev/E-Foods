/// <reference path="../_shared/edge-runtime.d.ts" />

const salt = () => Deno.env.get('AUTH_HASH_SALT') ?? '';

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
