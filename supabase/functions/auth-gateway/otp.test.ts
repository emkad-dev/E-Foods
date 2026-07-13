import { generateOtpCode, hashOtpCode } from './otp.ts';
import { parseRoute } from './router.ts';
import { normalizePhone } from '../_shared/phone.ts';

Deno.test('parseRoute maps the OTP routes', () => {
  if (parseRoute('https://x.fn/auth-gateway/otp-request') !== 'otp-request') throw new Error('otp-request');
  if (parseRoute('https://x.fn/auth-gateway/otp-verify') !== 'otp-verify') throw new Error('otp-verify');
});

Deno.test('generateOtpCode returns 6 digits', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateOtpCode();
    if (!/^\d{6}$/.test(code)) throw new Error(`bad code: ${code}`);
  }
});

Deno.test('hashOtpCode binds the code to the phone number', async () => {
  Deno.env.set('OTP_PEPPER', 'test-pepper');
  const a = await hashOtpCode('+2348031234567', '123456');
  const b = await hashOtpCode('+2348031234567', '123456');
  const otherPhone = await hashOtpCode('+2348031234568', '123456');
  const otherCode = await hashOtpCode('+2348031234567', '123457');
  if (a !== b) throw new Error('hash must be deterministic');
  if (a === otherPhone) throw new Error('hash must differ per phone');
  if (a === otherCode) throw new Error('hash must differ per code');
  if (!/^[0-9a-f]{64}$/.test(a)) throw new Error('expected hex sha-256 output');
});

Deno.test('server-side normalization matches the client contract', () => {
  const ng = normalizePhone('08031234567');
  if (!ng.ok || ng.e164 !== '+2348031234567') throw new Error('NG local');
  const gb = normalizePhone('+447123456789');
  if (!gb.ok || gb.e164 !== '+447123456789') throw new Error('GB e164');
  const us = normalizePhone('+15551234567');
  if (us.ok || us.reason !== 'unsupported_country') throw new Error('US must be rejected');
});
