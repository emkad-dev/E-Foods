import { safeAuthMessage } from './errors.ts';

Deno.test('login errors are non-enumerable', () => {
  if (safeAuthMessage('login', 400) !== safeAuthMessage('login', 403)) throw new Error('must not vary by status');
  if (!safeAuthMessage('login', 400).includes('Incorrect email or password')) throw new Error('generic login msg');
});
Deno.test('signup 422 maps to a safe non-committal message', () => {
  if (!safeAuthMessage('signup', 422).toLowerCase().includes('could not')) throw new Error('safe signup msg');
});
