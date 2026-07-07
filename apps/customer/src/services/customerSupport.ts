import { callCustomerBackendRpc } from './backendRpc';

export interface SupportConversation {
  id: string;
  status: 'open' | 'pending' | 'closed';
  lastMessageAt: string;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  senderType: 'customer' | 'agent' | 'system';
  body: string;
  createdAt: string;
}

export const getSupportThread = () =>
  callCustomerBackendRpc<{ conversation: SupportConversation | null; messages: SupportMessage[] }>(
    'customerGetSupportThread'
  );

export const sendSupportMessage = (body: string) =>
  callCustomerBackendRpc<{ conversation: SupportConversation; message: SupportMessage }>(
    'customerSendSupportMessage',
    { body }
  );
