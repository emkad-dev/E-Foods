import { validateEmail, validatePassword } from './validation.ts';

const throws = (work: () => void, needle: string) => {
  try { work(); } catch (e) { if (e instanceof Error && e.message.includes(needle)) return; throw e; }
  throw new Error(`Expected error containing "${needle}"`);
};

Deno.test('validateEmail normalizes valid email', () => {
  if (validateEmail('  User@Example.COM ') !== 'user@example.com') throw new Error('should normalize');
});
Deno.test('validateEmail rejects malformed', () => throws(() => validateEmail('not-an-email'), 'valid email'));
Deno.test('validateEmail rejects non-string', () => throws(() => validateEmail(42), 'valid email'));

Deno.test('validatePassword accepts compliant', () => {
  if (validatePassword('Abc123') !== 'Abc123') throw new Error('should accept');
});
Deno.test('validatePassword rejects too short', () => throws(() => validatePassword('Ab1'), 'at least 6'));
Deno.test('validatePassword rejects too long', () => throws(() => validatePassword('Aa1' + 'x'.repeat(130)), 'at most 128'));
Deno.test('validatePassword rejects missing digit', () => throws(() => validatePassword('Abcdef'), 'number'));
Deno.test('validatePassword rejects missing uppercase', () => throws(() => validatePassword('abc123'), 'uppercase'));
Deno.test('validatePassword rejects missing lowercase', () => throws(() => validatePassword('ABC123'), 'lowercase'));
