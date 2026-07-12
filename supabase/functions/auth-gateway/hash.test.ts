import { hashValue, redact } from './hash.ts';

Deno.env.set('AUTH_HASH_SALT', 'test-salt');

Deno.test('hashValue is stable and non-reversible-looking', async () => {
  const a = await hashValue('user@example.com');
  const b = await hashValue('user@example.com');
  if (a !== b) throw new Error('should be stable');
  if (a.includes('user@example.com')) throw new Error('should not contain input');
  if (a.length !== 64) throw new Error('should be 64 hex chars');
});
Deno.test('hashValue differs for different inputs', async () => {
  if (await hashValue('a@x.com') === await hashValue('b@x.com')) throw new Error('should differ');
});
Deno.test('redact masks sensitive keys', () => {
  const out = redact({ email: 'e', password: 'p', access_token: 't', refresh_token: 'r' });
  if (out.password !== '[redacted]' || out.access_token !== '[redacted]' || out.refresh_token !== '[redacted]') {
    throw new Error('should redact secrets');
  }
  if (out.email !== 'e') throw new Error('non-secret preserved');
});
