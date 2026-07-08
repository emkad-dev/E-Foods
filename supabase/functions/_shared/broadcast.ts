/// <reference path="./edge-runtime.d.ts" />

import { serviceClient } from './client.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const UNSUB_SECRET = Deno.env.get('BROADCAST_UNSUB_SECRET') ?? '';

export type BroadcastSegment = {
  roles?: string[];
  activity?: { orderedWithinDays?: number; notOrderedForDays?: number } | null;
  restaurantId?: string | null;
};

export type BroadcastRecipient = {
  uid: string;
  email: string | null;
  expoPushToken: string | null;
};

const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

// Customer uids matching the activity/restaurant filters (customer-only filters,
// derived from CustomerOrder history).
const resolveCustomerUids = async (segment: BroadcastSegment): Promise<string[]> => {
  const activity = segment.activity ?? null;
  const restaurantId = segment.restaurantId ?? null;

  let query = serviceClient.from('CustomerOrder').select('customerId,createdAt,restaurantId');
  if (restaurantId) {
    query = query.eq('restaurantId', restaurantId);
  }
  const { data, error } = await query.returns<
    Array<{ customerId: string; createdAt: string; restaurantId: string }>
  >();
  if (error) {
    throw new Error(error.message);
  }

  const lastOrderByCustomer = new Map<string, number>();
  for (const row of data ?? []) {
    const ts = new Date(row.createdAt).getTime();
    const prev = lastOrderByCustomer.get(row.customerId) ?? 0;
    if (ts > prev) {
      lastOrderByCustomer.set(row.customerId, ts);
    }
  }

  let uids = Array.from(lastOrderByCustomer.keys());
  if (activity?.orderedWithinDays) {
    const cutoff = Date.now() - activity.orderedWithinDays * 86_400_000;
    uids = uids.filter((uid) => (lastOrderByCustomer.get(uid) ?? 0) >= cutoff);
  } else if (activity?.notOrderedForDays) {
    const cutoff = Date.now() - activity.notOrderedForDays * 86_400_000;
    uids = uids.filter((uid) => (lastOrderByCustomer.get(uid) ?? 0) < cutoff);
  }
  return uniq(uids);
};

const uidsByRoles = async (roles: string[]): Promise<string[]> => {
  const wanted = uniq(roles);
  if (wanted.length === 0) {
    return [];
  }
  const { data, error } = await serviceClient.from('UserRole').select('userId,role').in('role', wanted);
  if (error) {
    throw new Error(error.message);
  }
  return uniq(((data ?? []) as Array<{ userId: string }>).map((row) => row.userId));
};

// Resolves a segment spec to deduped recipients. AND-semantics across dimensions
// for customers (roles ∪, then activity/restaurant filters); non-customer roles are
// unioned in unfiltered. Marketing sends drop suppressed emails and disabled accounts.
export const resolveBroadcastAudience = async (
  segment: BroadcastSegment,
  category: string
): Promise<BroadcastRecipient[]> => {
  const roles = segment.roles ?? [];
  const hasCustomerFilter = Boolean(segment.activity || segment.restaurantId);
  const wantsCustomers = roles.includes('customer');

  let uids: string[] = [];
  const nonCustomerRoles = roles.filter((role) => role !== 'customer');
  if (nonCustomerRoles.length > 0) {
    uids = uids.concat(await uidsByRoles(nonCustomerRoles));
  }

  if (wantsCustomers) {
    uids = uids.concat(hasCustomerFilter ? await resolveCustomerUids(segment) : await uidsByRoles(['customer']));
  } else if (hasCustomerFilter && roles.length === 0) {
    // Only customer filters given, no explicit roles -> treat as customers.
    uids = uids.concat(await resolveCustomerUids(segment));
  }

  uids = uniq(uids);
  if (uids.length === 0) {
    return [];
  }

  const { data: accounts, error } = await serviceClient
    .from('UserAccount')
    .select('uid,email,expoPushToken,accountDisabled')
    .in('uid', uids)
    .returns<
      Array<{ uid: string; email: string | null; expoPushToken: string | null; accountDisabled: boolean | null }>
    >();
  if (error) {
    throw new Error(error.message);
  }

  let recipients: BroadcastRecipient[] = (accounts ?? [])
    .filter((account) => !account.accountDisabled)
    .map((account) => ({ uid: account.uid, email: account.email, expoPushToken: account.expoPushToken }));

  if (category === 'marketing') {
    const emails = uniq(recipients.map((recipient) => (recipient.email ?? '').toLowerCase()));
    if (emails.length > 0) {
      const { data: suppressed, error: suppressionError } = await serviceClient
        .from('EmailSuppression')
        .select('email')
        .in('email', emails)
        .returns<Array<{ email: string }>>();
      if (suppressionError) {
        throw new Error(suppressionError.message);
      }
      const blocked = new Set((suppressed ?? []).map((row) => row.email.toLowerCase()));
      recipients = recipients.filter((recipient) => !blocked.has((recipient.email ?? '').toLowerCase()));
    }
  }

  return recipients;
};

const hmacHex = async (message: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const signUnsubscribe = (email: string) => hmacHex(email.toLowerCase(), UNSUB_SECRET);

export const verifyUnsubscribe = async (email: string, token: string): Promise<boolean> => {
  if (!UNSUB_SECRET || !token) {
    return false;
  }
  const expected = await signUnsubscribe(email);
  if (expected.length !== token.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ token.charCodeAt(index);
  }
  return diff === 0;
};

export const unsubscribeUrl = async (email: string): Promise<string> => {
  const token = await signUnsubscribe(email);
  const base = SUPABASE_URL.replace(/\/$/, '');
  return `${base}/functions/v1/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
};

// The email body is admin-authored HTML (admin-only feature, trusted input);
// only the footer is generated here.
export const buildBroadcastEmailHtml = (input: {
  body: string;
  includeUnsubscribe: boolean;
  unsubUrl?: string;
}): string => {
  const footer =
    input.includeUnsubscribe && input.unsubUrl
      ? `<p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">FEASTy • <a href="${input.unsubUrl}" style="color:#94a3b8;">Unsubscribe</a> from marketing emails.</p>`
      : '<p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">FEASTy</p>';

  return [
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:15px;line-height:1.6;">',
    input.body,
    footer,
    '</div>',
  ].join('');
};
