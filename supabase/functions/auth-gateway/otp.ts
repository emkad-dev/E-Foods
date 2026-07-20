/// <reference path="../_shared/edge-runtime.d.ts" />

import { serviceClient } from '../_shared/client.ts';
import { ClientSafeError, logEdgeEvent } from '../_shared/observability.ts';
import { normalizePhone, phoneRejectionMessage } from '../_shared/phone.ts';
import { sendOtpMessage, type OtpChannel } from './termii.ts';

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

const CODE_EXPIRED_MESSAGE = 'That code has expired — request a new one.';
const CODE_MISMATCH_MESSAGE = "That code didn't work. Check it and try again.";
const TOO_MANY_ATTEMPTS_MESSAGE = 'Too many attempts — request a new code.';

/** Uniform 6-digit code via rejection sampling (no modulo bias). */
export const generateOtpCode = (): string => {
  const buf = new Uint32Array(1);
  const bound = 4294000000; // largest multiple of 10^6 below 2^32
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= bound);
  return String(buf[0] % 1_000_000).padStart(6, '0');
};

/**
 * HMAC-SHA-256 over `phone:code` with OTP_PEPPER — binds the code to the
 * phone number and keeps stored hashes useless without the server secret.
 */
export const hashOtpCode = async (phoneE164: string, code: string): Promise<string> => {
  const pepper = Deno.env.get('OTP_PEPPER') ?? '';
  if (!pepper) {
    logEdgeEvent('error', 'OTP_PEPPER is not configured', {});
    throw new Error('OTP_PEPPER missing'); // internal: surfaces as generic 500
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${phoneE164}:${code}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const parseOtpPhone = (value: unknown): { e164: string } => {
  const result = normalizePhone(typeof value === 'string' ? value : '');
  if (!result.ok) throw new ClientSafeError(400, phoneRejectionMessage(result.reason));
  return { e164: result.e164 };
};

export const parseOtpChannel = (value: unknown): OtpChannel => {
  if (value === 'whatsapp') return 'whatsapp';
  if (value === 'sms' || value === undefined || value === null || value === '') return 'sms';
  throw new ClientSafeError(400, 'Choose SMS or WhatsApp for the code.');
};

export const requestOtp = async (
  uid: string,
  phoneE164: string,
  channel: OtpChannel,
): Promise<{ success: true; expiresInSeconds: number; resendInSeconds: number }> => {
  const code = generateOtpCode();
  const codeHash = await hashOtpCode(phoneE164, code); // fails fast if OTP_PEPPER is missing

  // Supersede prior pending codes for this (uid, phone) pair.
  await serviceClient
    .from('phone_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('uid', uid)
    .eq('phone_e164', phoneE164)
    .is('consumed_at', null);

  const { error } = await serviceClient.from('phone_otps').insert({
    uid,
    phone_e164: phoneE164,
    channel,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) {
    logEdgeEvent('error', 'phone_otps insert failed', { reason: error.message });
    throw new Error('otp insert failed');
  }

  await sendOtpMessage(phoneE164, code, channel);

  return { success: true, expiresInSeconds: OTP_TTL_SECONDS, resendInSeconds: OTP_RESEND_SECONDS };
};

export const verifyOtp = async (
  uid: string,
  phoneE164: string,
  rawCode: unknown,
): Promise<{ success: true; phoneNumber: string; phoneVerifiedAt: string }> => {
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!/^\d{6}$/.test(code)) throw new ClientSafeError(400, 'Enter the 6-digit code.');

  const { data, error } = await serviceClient
    .from('phone_otps')
    .select('id, code_hash, expires_at, attempts')
    .eq('uid', uid)
    .eq('phone_e164', phoneE164)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logEdgeEvent('error', 'phone_otps lookup failed', { reason: error.message });
    throw new Error('otp lookup failed');
  }

  if (!data || new Date(data.expires_at).getTime() <= Date.now()) {
    throw new ClientSafeError(400, CODE_EXPIRED_MESSAGE);
  }
  if (data.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ClientSafeError(429, TOO_MANY_ATTEMPTS_MESSAGE);
  }

  const expected = await hashOtpCode(phoneE164, code);
  if (!constantTimeEqual(expected, data.code_hash)) {
    await serviceClient.from('phone_otps').update({ attempts: data.attempts + 1 }).eq('id', data.id);
    throw new ClientSafeError(400, CODE_MISMATCH_MESSAGE);
  }

  const phoneVerifiedAt = new Date().toISOString();
  await serviceClient.from('phone_otps').update({ consumed_at: phoneVerifiedAt }).eq('id', data.id);

  const { error: profileError } = await serviceClient
    .from('UserAccount')
    .update({ phoneNumber: phoneE164, phoneVerifiedAt, updatedAt: phoneVerifiedAt })
    .eq('uid', uid);
  if (profileError) {
    logEdgeEvent('error', 'UserAccount phone update failed', { reason: profileError.message });
    throw new Error('profile update failed');
  }

  return { success: true, phoneNumber: phoneE164, phoneVerifiedAt };
};
