/// <reference path="./edge-runtime.d.ts" />

import { serviceClient } from './client.ts';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
const emailFrom = Deno.env.get('TRANSACTIONAL_EMAIL_FROM') ?? 'FEASTy <onboarding@resend.dev>';

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const formatNairaAmount = (amount: unknown) => {
  const numericAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return `₦${numericAmount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
};

export const shortOrderCode = (orderId: string) => orderId.slice(-6).toUpperCase();

export const buildTransactionalEmailHtml = (input: {
  heading: string;
  lines: string[];
  recipientName?: string | null;
}) => {
  const greeting = input.recipientName?.trim() ? `Hi ${escapeHtml(input.recipientName.trim())},` : 'Hi,';
  const paragraphs = input.lines
    .map((line) => `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join('');

  return [
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;">',
    `<h2 style="margin:0 0 16px;color:#0f172a;font-size:20px;">${escapeHtml(input.heading)}</h2>`,
    `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;">${greeting}</p>`,
    paragraphs,
    '<p style="margin:24px 0 0;color:#94a3b8;font-size:13px;">FEASTy • This is an automated message, no reply is needed.</p>',
    '</div>',
  ].join('');
};

// Transactional email is best-effort: failures are logged and reported through
// the return value, but never thrown, so order flows are not interrupted.
export const sendTransactionalEmail = async (input: { html: string; subject: string; to: string }) => {
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY is not configured; skipping transactional email.');
    return { sent: false };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        html: input.html,
        subject: input.subject,
        to: [input.to],
      }),
    });

    if (!response.ok) {
      console.error('Transactional email delivery failed.', response.status, await response.text());
      return { sent: false };
    }

    return { sent: true };
  } catch (error) {
    console.error('Transactional email delivery failed.', error);
    return { sent: false };
  }
};

export const loadUserEmailRecipient = async (uid: string) => {
  const { data, error } = await serviceClient
    .from('UserAccount')
    .select('email,displayName')
    .eq('uid', uid)
    .maybeSingle<{ displayName?: string | null; email?: string | null }>();

  if (error) {
    console.error('Unable to load email recipient.', error.message);
    return null;
  }

  const email = typeof data?.email === 'string' && data.email.trim() ? data.email.trim() : null;
  if (!email) {
    return null;
  }

  return {
    displayName: typeof data?.displayName === 'string' && data.displayName.trim() ? data.displayName.trim() : null,
    email,
  };
};
