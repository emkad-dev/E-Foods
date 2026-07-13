import { clientIp, parseRoute } from './router.ts';

Deno.test('parseRoute maps known paths', () => {
  if (parseRoute('https://x.fn/auth-gateway/login') !== 'login') throw new Error('login');
  if (parseRoute('https://x.fn/auth-gateway/signup') !== 'signup') throw new Error('signup');
  if (parseRoute('https://x.fn/auth-gateway/logout') !== 'logout') throw new Error('logout');
  if (parseRoute('https://x.fn/auth-gateway/refresh') !== 'refresh') throw new Error('refresh');
});
Deno.test('parseRoute returns null for unknown', () => {
  if (parseRoute('https://x.fn/auth-gateway/admin') !== null) throw new Error('null');
});

Deno.test('clientIp uses the rightmost (proxy-appended) XFF entry, not the spoofable leftmost', () => {
  const req = new Request('https://x.fn/auth-gateway/login', {
    headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 9.9.9.9' },
  });
  if (clientIp(req) !== '9.9.9.9') throw new Error('should trust the rightmost entry');
});
Deno.test('clientIp falls back to x-real-ip then unknown', () => {
  const req = new Request('https://x.fn/auth-gateway/login', { headers: { 'x-real-ip': '3.3.3.3' } });
  if (clientIp(req) !== '3.3.3.3') throw new Error('should use x-real-ip');
  if (clientIp(new Request('https://x.fn/auth-gateway/login')) !== 'unknown') throw new Error('should be unknown');
});
