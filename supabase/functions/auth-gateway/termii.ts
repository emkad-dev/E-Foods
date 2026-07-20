/// <reference path="../_shared/edge-runtime.d.ts" />

import { ClientSafeError, logEdgeEvent } from '../_shared/observability.ts';

export type OtpChannel = 'sms' | 'whatsapp';

const TERMII_SEND_URL = 'https://api.ng.termii.com/api/sms/send';

const SEND_FAILED_MESSAGE = "We couldn't send the code right now. Please try again shortly.";

/**
 * Deliver a verification code via Termii. SMS uses the `dnd` route so
 * DND-blocked Nigerian numbers still receive it; WhatsApp uses the `whatsapp`
 * channel with the same message body.
 *
 * With OTP_DEV_MODE=true the code is logged server-side instead of sent, so
 * the flow is testable before a Termii account exists.
 */
export const sendOtpMessage = async (
  phoneE164: string,
  code: string,
  channel: OtpChannel,
): Promise<void> => {
  if ((Deno.env.get('OTP_DEV_MODE') ?? '').toLowerCase() === 'true') {
    // Deliberate: dev mode is the only place a code may appear in logs.
    logEdgeEvent('info', 'OTP_DEV_MODE — code logged instead of sent', {
      phoneSuffix: phoneE164.slice(-4),
      channel,
      code,
    });
    return;
  }

  const apiKey = Deno.env.get('TERMII_API_KEY');
  const senderId = Deno.env.get('TERMII_SENDER_ID');
  if (!apiKey || !senderId) {
    logEdgeEvent('error', 'Termii not configured (TERMII_API_KEY / TERMII_SENDER_ID missing)', {});
    throw new ClientSafeError(503, SEND_FAILED_MESSAGE);
  }

  const response = await fetch(TERMII_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      to: phoneE164.slice(1), // Termii expects digits without the leading '+'
      from: senderId,
      sms: `Your FEASTY verification code is ${code}. It expires in 5 minutes. Never share this code.`,
      type: 'plain',
      channel: channel === 'whatsapp' ? 'whatsapp' : 'dnd',
    }),
  }).catch((error: unknown) => {
    logEdgeEvent('error', 'Termii request failed', {
      reason: error instanceof Error ? error.message : 'network error',
    });
    throw new ClientSafeError(502, SEND_FAILED_MESSAGE);
  });

  if (!response.ok) {
    // Never log the code or full phone number — status + suffix is enough to debug.
    const detail = await response.text().catch(() => '');
    logEdgeEvent('error', 'Termii rejected the send', {
      status: response.status,
      phoneSuffix: phoneE164.slice(-4),
      channel,
      detail: detail.slice(0, 300),
    });
    throw new ClientSafeError(502, SEND_FAILED_MESSAGE);
  }
};
