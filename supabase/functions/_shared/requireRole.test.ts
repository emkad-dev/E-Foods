import { hasAllowedRole, roleFromClaims } from './roles.ts';

Deno.test('roleFromClaims reads user_role', () => {
  if (roleFromClaims({ user_role: 'admin' }) !== 'admin') throw new Error('should read admin');
});
Deno.test('roleFromClaims rejects unknown role', () => {
  if (roleFromClaims({ user_role: 'wizard' }) !== null) throw new Error('should be null');
});
Deno.test('hasAllowedRole true when allowed', () => {
  if (!hasAllowedRole({ role: 'support' }, ['admin', 'support'])) throw new Error('should allow');
});
Deno.test('hasAllowedRole false when not allowed', () => {
  if (hasAllowedRole({ role: 'customer' }, ['admin'])) throw new Error('should deny');
});
Deno.test('hasAllowedRole false when no role claim', () => {
  if (hasAllowedRole({}, ['admin'])) throw new Error('should deny');
});
