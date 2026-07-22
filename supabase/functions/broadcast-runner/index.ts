/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';
import {
  buildBroadcastEmailHtml,
  resolveBroadcastAudience,
  unsubscribeUrl,
  type BroadcastSegment,
} from '../_shared/broadcast.ts';
import { sendExpoPushMessages } from '../_shared/notifications.ts';

const WORKER_TOKEN = Deno.env.get('QUEUE_WORKER_TOKEN')?.trim() ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('TRANSACTIONAL_EMAIL_FROM') ?? 'FEASTY <onboarding@resend.dev>';
const RESEND_BATCH_ENDPOINT = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100;

const chunkArray = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

type BroadcastRow = {
  id: string;
  category: string;
  channels: string[];
  segment: BroadcastSegment;
  emailSubject: string | null;
  emailBody: string | null;
  pushTitle: string | null;
  pushBody: string | null;
};

const sendEmailBatch = async (
  messages: Array<{ from: string; to: string[]; subject: string; html: string }>
): Promise<number> => {
  if (!RESEND_API_KEY || messages.length === 0) {
    return 0;
  }
  const response = await fetch(RESEND_BATCH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    console.error('Broadcast email batch failed.', response.status, await response.text());
    return 0;
  }
  return messages.length;
};

const processBroadcast = async (broadcast: BroadcastRow) => {
  const recipients = await resolveBroadcastAudience(broadcast.segment, broadcast.category);
  let sentEmail = 0;
  let failedEmail = 0;
  let sentPush = 0;
  let failedPush = 0;

  await serviceClient.from('Broadcast').update({ recipientCount: recipients.length }).eq('id', broadcast.id);

  if (broadcast.channels.includes('email') && broadcast.emailSubject && broadcast.emailBody) {
    const withEmail = recipients.filter((recipient) => recipient.email);
    for (const group of chunkArray(withEmail, BATCH_SIZE)) {
      try {
        const messages = await Promise.all(
          group.map(async (recipient) => {
            const includeUnsubscribe = broadcast.category === 'marketing';
            const unsubUrl = includeUnsubscribe ? await unsubscribeUrl(recipient.email as string) : undefined;
            return {
              from: EMAIL_FROM,
              to: [recipient.email as string],
              subject: broadcast.emailSubject as string,
              html: buildBroadcastEmailHtml({
                body: broadcast.emailBody as string,
                includeUnsubscribe,
                unsubUrl,
              }),
            };
          })
        );
        const sent = await sendEmailBatch(messages);
        sentEmail += sent;
        failedEmail += group.length - sent;
      } catch (error) {
        console.error('Broadcast email batch error.', error);
        failedEmail += group.length;
      }
    }
  }

  if (broadcast.channels.includes('push') && broadcast.pushTitle && broadcast.pushBody) {
    const tokens = recipients
      .map((recipient) => recipient.expoPushToken)
      .filter((token): token is string => Boolean(token));
    for (const group of chunkArray(tokens, BATCH_SIZE)) {
      try {
        const result = await sendExpoPushMessages(
          group.map((to) => ({
            to,
            title: broadcast.pushTitle as string,
            body: broadcast.pushBody as string,
            sound: 'default' as const,
          }))
        );
        sentPush += result.sent;
        failedPush += group.length - result.sent;
      } catch (error) {
        console.error('Broadcast push batch error.', error);
        failedPush += group.length;
      }
    }
  }

  const anySuccess = sentEmail > 0 || sentPush > 0 || recipients.length === 0;
  await serviceClient
    .from('Broadcast')
    .update({
      status: anySuccess ? 'sent' : 'failed',
      sentEmail,
      failedEmail,
      sentPush,
      failedPush,
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq('id', broadcast.id);
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const token = request.headers.get('x-queue-worker-token')?.trim() ?? '';
  if (!WORKER_TOKEN || token !== WORKER_TOKEN) {
    return json(401, { error: { message: 'Unauthorized' } });
  }

  // Atomic claim: scheduled + due -> sending, so a second tick can't double-send.
  const nowIso = new Date().toISOString();
  const { data: claimed, error } = await serviceClient
    .from('Broadcast')
    .update({ status: 'sending', updatedAt: nowIso })
    .eq('status', 'scheduled')
    .lte('scheduledAt', nowIso)
    .select('*')
    .returns<BroadcastRow[]>();
  if (error) {
    return json(500, { error: { message: error.message } });
  }

  const broadcasts = claimed ?? [];
  for (const broadcast of broadcasts) {
    try {
      await processBroadcast(broadcast);
    } catch (processError) {
      console.error('processBroadcast failed.', broadcast.id, processError);
      await serviceClient
        .from('Broadcast')
        .update({ status: 'failed', updatedAt: new Date().toISOString() })
        .eq('id', broadcast.id);
    }
  }

  return json(200, { data: { processed: broadcasts.length } });
});
