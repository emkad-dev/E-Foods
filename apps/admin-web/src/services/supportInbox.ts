import { callAdminRpc } from '../lib/rpc';
import type { AdminTone } from '../theme/tones';

export type SupportStatus = 'open' | 'pending' | 'closed';

export interface InboxConversation {
  id: string;
  customerId: string;
  customerName: string;
  subject: string | null;
  status: SupportStatus;
  assignedTo: string | null;
  lastMessageAt: string;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  senderType: 'customer' | 'agent' | 'system';
  senderId: string | null;
  body: string;
  emailSent: boolean;
  pushSent: boolean;
  createdAt: string;
}

export const getSupportTone = (status: SupportStatus): AdminTone => {
  switch (status) {
    case 'closed':
      return 'neutral';
    case 'pending':
      return 'info';
    case 'open':
    default:
      return 'warning';
  }
};

/** What the admin reads for each stored status; the stored values never change. */
export const supportStatusLabel = (status: SupportStatus): string => {
  switch (status) {
    case 'pending':
      return 'Waiting on customer';
    case 'closed':
      return 'Closed';
    case 'open':
    default:
      return 'Open';
  }
};

export const getInbox = (params: { status?: SupportStatus; scope?: 'mine' | 'unassigned' | 'all' }) =>
  callAdminRpc<{ conversations: InboxConversation[] }>('supportGetInbox', params);

export const getConversation = (conversationId: string) =>
  callAdminRpc<{ conversation: InboxConversation; messages: SupportMessage[] }>('supportGetConversation', {
    conversationId,
  });

export const sendAgentReply = (conversationId: string, body: string) =>
  callAdminRpc<{ message: SupportMessage }>('supportSendAgentReply', { conversationId, body }, { write: true });

export const setStatus = (conversationId: string, status: SupportStatus) =>
  callAdminRpc<{ conversation: InboxConversation }>('supportSetConversationStatus', { conversationId, status }, { write: true });

export const assignConversation = (conversationId: string, assignTo: string | null | 'me') =>
  callAdminRpc<{ conversation: InboxConversation }>('supportAssignConversation', { conversationId, assignTo }, { write: true });
