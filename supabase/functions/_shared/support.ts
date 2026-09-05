// Support inbox rows shared by the customer-facing thread and the agent inbox.

import { serviceClient } from './client.ts';
import { nowIso } from './rpc/coercion.ts';

export type SupportConversationRow = {
  id: string;
  customerId: string;
  subject: string | null;
  status: string;
  assignedTo: string | null;
  channel: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportMessageRow = {
  id: string;
  conversationId: string;
  senderType: string;
  senderId: string | null;
  body: string;
  emailSent: boolean;
  pushSent: boolean;
  createdAt: string;
};

const SUPPORT_STATUSES = ['open', 'pending', 'closed'] as const;

export const isSupportStatus = (value: unknown): value is (typeof SUPPORT_STATUSES)[number] =>
  typeof value === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(value);

/** Appends a message and bumps the conversation's activity timestamps. */
export const appendSupportMessage = async (input: {
  conversationId: string;
  senderType: 'customer' | 'agent' | 'system';
  senderId: string | null;
  body: string;
  emailSent?: boolean;
  pushSent?: boolean;
}): Promise<SupportMessageRow> => {
  const { data, error } = await serviceClient
    .from('SupportMessage')
    .insert({
      conversationId: input.conversationId,
      senderType: input.senderType,
      senderId: input.senderId,
      body: input.body,
      emailSent: input.emailSent ?? false,
      pushSent: input.pushSent ?? false,
    })
    .select('*')
    .single<SupportMessageRow>();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to persist the support message.');
  }

  const timestamp = nowIso();
  await serviceClient
    .from('SupportConversation')
    .update({ lastMessageAt: timestamp, updatedAt: timestamp })
    .eq('id', input.conversationId);

  return data;
};
