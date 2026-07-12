import { parseRoute } from './router.ts';

Deno.test('parseRoute maps known paths', () => {
  if (parseRoute('https://x.fn/auth-gateway/login') !== 'login') throw new Error('login');
  if (parseRoute('https://x.fn/auth-gateway/signup') !== 'signup') throw new Error('signup');
  if (parseRoute('https://x.fn/auth-gateway/logout') !== 'logout') throw new Error('logout');
  if (parseRoute('https://x.fn/auth-gateway/refresh') !== 'refresh') throw new Error('refresh');
});
Deno.test('parseRoute returns null for unknown', () => {
  if (parseRoute('https://x.fn/auth-gateway/admin') !== null) throw new Error('null');
});
