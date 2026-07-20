import { hashValue, redact } from './hash.ts';

Deno.env.set('AUTH_HASH_SALT', 'test-salt-0123456789'); // >= 16 chars

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
Deno.test('hashValue throws when the salt is missing or too short', async () => {
  const prev = Deno.env.get('AUTH_HASH_SALT');
  Deno.env.set('AUTH_HASH_SALT', 'short');
  try {
    await hashValue('x');
    throw new Error('should have thrown on short salt');
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes('AUTH_HASH_SALT')) throw e;
  } finally {
    if (prev !== undefined) Deno.env.set('AUTH_HASH_SALT', prev);
  }
});
Deno.test('redact masks sensitive keys', () => {
  const out = redact({ email: 'e', password: 'p', access_token: 't', refresh_token: 'r' });
  if (out.password !== '[redacted]' || out.access_token !== '[redacted]' || out.refresh_token !== '[redacted]') {
    throw new Error('should redact secrets');
  }
  if (out.email !== 'e') throw new Error('non-secret preserved');
});
