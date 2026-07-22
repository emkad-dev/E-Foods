/// <reference path="../_shared/edge-runtime.d.ts" />

import { serviceClient } from '../_shared/client.ts';
import { verifyUnsubscribe } from '../_shared/broadcast.ts';

const page = (title: string, message: string) =>
  new Response(
    [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${title}</title></head>`,
      '<body style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:64px auto;padding:0 24px;color:#0f172a;text-align:center;">',
      `<h2>${title}</h2>`,
      `<p style="color:#475569;font-size:15px;line-height:1.6;">${message}</p>`,
      '</body></html>',
    ].join(''),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') ?? '').trim().toLowerCase();
  const token = url.searchParams.get('t') ?? '';

  if (!email || !(await verifyUnsubscribe(email, token))) {
    return page('Link invalid', 'This unsubscribe link is invalid or has expired.');
  }

  const { error } = await serviceClient
    .from('EmailSuppression')
    .upsert({ email, reason: 'unsubscribe' }, { onConflict: 'email' });
  if (error) {
    console.error('Unsubscribe upsert failed.', error.message);
    return page('Something went wrong', 'We could not process your request. Please try again later.');
  }

  return page(
    'Unsubscribed',
    `${email} has been removed from FEASTY marketing emails. You will still receive important account and order updates.`
  );
});
