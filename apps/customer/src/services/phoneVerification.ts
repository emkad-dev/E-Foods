import { createGatewayAuth } from '../../../../packages/auth/src/gatewayAuth';
import type { PhoneOtpChannel } from '../../../../packages/auth/src/gatewayAuth';
import { supabaseEnv } from '../config/env';
import { supabase } from './supabase/config';

const gateway = createGatewayAuth({
  gatewayUrl: `${supabaseEnv.url ?? ''}/functions/v1/auth-gateway`,
  anonKey: supabaseEnv.anonKey ?? '',
});

const accessToken = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Please sign in again to verify your phone number.');
  }
  return token;
};

export const requestPhoneCode = async (e164: string, channel: PhoneOtpChannel) =>
  gateway.requestPhoneOtp(await accessToken(), e164, channel);

export const verifyPhoneCode = async (e164: string, code: string) =>
  gateway.verifyPhoneOtp(await accessToken(), e164, code);
